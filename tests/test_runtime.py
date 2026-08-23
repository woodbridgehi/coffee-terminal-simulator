from __future__ import annotations

import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from urllib.request import urlopen


PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "coffee-terminal"))

from backend import CoffeeDeviceRuntime  # noqa: E402


class RuntimeTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.instance = Path(self.temporary.name)
        (self.instance / "recipes").mkdir()
        (self.instance / "state").mkdir()
        self.write_json("materials.json", {"materials": [
            {"materialId": "beans", "name": "咖啡豆", "unit": "g", "capacity": 100, "initialOnHand": 40, "lowThreshold": 10, "criticalThreshold": 2, "enabled": True},
            {"materialId": "cup", "name": "纸杯", "unit": "count", "capacity": 10, "initialOnHand": 2, "lowThreshold": 1, "criticalThreshold": 0, "enabled": True},
        ]})
        self.write_json("failures.json", {"globalFailureRate": 0, "profiles": {"brewer": {"failureRate": 0, "timing": "after", "errorCode": "BREWER_ERROR", "message": "萃取失败", "retryable": True, "maxRetries": 1, "consumeOnFailure": True}}, "stepOverrides": {}})
        self.write_json("recipes/coffee.json", {"recipeId": "coffee-v1", "skuCode": "COFFEE", "version": "1.0.0", "name": "测试咖啡", "enabled": True, "steps": [
            {"id": "cup", "name": "取杯", "durationSeconds": 0.05, "consumes": [{"materialId": "cup", "amount": 1, "unit": "count"}]},
            {"id": "brew", "name": "萃取", "durationSeconds": 0.05, "durationRandomization": {"minSeconds": 0.02, "maxSeconds": 0.08}, "failureProfile": "brewer", "consumes": [{"materialId": "beans", "amount": 10, "unit": "g"}]},
        ]})
        self.write_json("recipes/strong.json", {"recipeId": "strong-v1", "skuCode": "STRONG", "version": "1.0.0", "name": "浓咖啡", "enabled": True, "steps": [
            {"id": "cup", "name": "取杯", "durationSeconds": 0.05, "consumes": [{"materialId": "cup", "amount": 1, "unit": "count"}]},
            {"id": "brew-strong", "name": "浓萃取", "durationSeconds": 0.05, "consumes": [{"materialId": "beans", "amount": 20, "unit": "g"}]},
        ]})
        self.config = {"instanceId": "test-instance", "deviceId": "test-device", "deviceName": "TEST", "storeId": "test-store", "backend": {"mode": "local", "baseUrl": "http://localhost:8080"}, "localApi": {"enabled": True, "host": "127.0.0.1", "port": 0}}
        self.runtime = CoffeeDeviceRuntime(self.config, self.instance)

    def tearDown(self) -> None:
        self.runtime.close()
        self.temporary.cleanup()

    def write_json(self, relative: str, payload: dict) -> None:
        path = self.instance / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    def wait_for(self, expected: str, timeout: float = 3) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if (self.runtime.runtime.get("task") or {}).get("state") == expected:
                return
            time.sleep(0.05)
        self.fail(f"task did not reach {expected}: {self.runtime.status()}")

    def test_local_api_capability_execution_and_shortage(self) -> None:
        port = self.runtime.local_api.server.server_port
        with urlopen(f"http://127.0.0.1:{port}/device/v1/capabilities", timeout=2) as response:
            capability = json.load(response)
        self.assertTrue(capability["products"][0]["available"])
        self.assertEqual(capability["products"][0]["maxServings"], 2)

        self.assertTrue(self.runtime.start_demo_order("coffee-v1")["ok"])
        self.wait_for("SUCCEEDED")
        inventory = {item["materialId"]: item for item in self.runtime.inventory_snapshot()["materials"]}
        self.assertEqual(inventory["cup"]["onHand"], 1)
        self.assertEqual(inventory["beans"]["onHand"], 30)
        self.assertEqual(inventory["cup"]["reserved"], 0)

        self.runtime.command("clear")
        self.assertTrue(self.runtime.adjust_inventory({"materialId": "cup", "mode": "SET", "amount": 0, "reason": "TEST"})["ok"])
        product = self.runtime.capabilities()["products"][0]
        self.assertFalse(product["available"])
        self.assertIn("MATERIAL_INSUFFICIENT", product["unavailableReasons"])
        rejected = self.runtime.start_demo_order("coffee-v1")
        self.assertFalse(rejected["ok"])
        self.assertEqual(rejected["error"], "MATERIAL_INSUFFICIENT")

    def test_forced_failure_releases_remaining_reservation(self) -> None:
        self.assertTrue(self.runtime.command("force-fail")["ok"])
        self.assertTrue(self.runtime.start_demo_order("coffee-v1")["ok"])
        self.wait_for("FAILED")
        inventory = {item["materialId"]: item for item in self.runtime.inventory_snapshot()["materials"]}
        self.assertEqual(inventory["cup"]["onHand"], 1)
        self.assertEqual(inventory["beans"]["onHand"], 40)
        self.assertEqual(inventory["cup"]["reserved"], 0)
        self.assertEqual(inventory["beans"]["reserved"], 0)

    def test_random_duration_and_different_drinks_share_inventory(self) -> None:
        capability = {item["recipeId"]: item for item in self.runtime.capabilities()["products"]}
        self.assertEqual(capability["coffee-v1"]["durationRangeSeconds"], {"min": 0.07, "max": 0.13})

        self.assertTrue(self.runtime.start_demo_order("coffee-v1")["ok"])
        task = self.runtime.runtime["task"]
        randomized = task["recipe"]["steps"][1]
        self.assertGreaterEqual(randomized["durationSeconds"], 0.02)
        self.assertLessEqual(randomized["durationSeconds"], 0.08)
        self.assertEqual(randomized["configuredDurationSeconds"], 0.05)
        self.wait_for("SUCCEEDED")
        self.runtime.command("clear")

        after_first = {item["materialId"]: item for item in self.runtime.inventory_snapshot()["materials"]}
        self.assertEqual(after_first["beans"]["onHand"], 30)
        self.assertEqual(after_first["cup"]["onHand"], 1)
        self.assertEqual({item["recipeId"]: item for item in self.runtime.capabilities()["products"]}["strong-v1"]["maxServings"], 1)

        self.assertTrue(self.runtime.start_demo_order("strong-v1")["ok"])
        self.wait_for("SUCCEEDED")
        after_second = {item["materialId"]: item for item in self.runtime.inventory_snapshot()["materials"]}
        self.assertEqual(after_second["beans"]["onHand"], 10)
        self.assertEqual(after_second["cup"]["onHand"], 0)


if __name__ == "__main__":
    unittest.main()
