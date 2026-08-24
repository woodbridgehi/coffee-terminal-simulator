from __future__ import annotations

import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


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

    def wait_for_step(self, step_id: str, timeout: float = 3) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            task = self.runtime.runtime.get("task") or {}
            steps = task.get("recipe", {}).get("steps", [])
            if steps and steps[task.get("stepIndex", 0)]["id"] == step_id:
                return
            time.sleep(0.02)
        self.fail(f"task did not reach step {step_id}: {self.runtime.status()}")

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

    def test_disabled_recipe_and_unknown_inventory_mode_are_rejected(self) -> None:
        recipe_path = self.instance / "recipes" / "coffee.json"
        recipe = json.loads(recipe_path.read_text(encoding="utf-8"))
        recipe["enabled"] = False
        self.write_json("recipes/coffee.json", recipe)
        self.assertTrue(self.runtime.reload_config()["ok"])

        rejected = self.runtime.start_demo_order("coffee-v1")
        self.assertFalse(rejected["ok"])
        self.assertEqual(rejected["error"], "RECIPE_DISABLED")

        adjustment = self.runtime.adjust_inventory({"materialId": "beans", "mode": "SUB", "amount": 1})
        self.assertFalse(adjustment["ok"])
        self.assertIn("ADD 或 SET", adjustment["error"])

    def test_failure_retry_records_consumption_for_each_execution_attempt(self) -> None:
        self.assertTrue(self.runtime.start_demo_order("coffee-v1")["ok"])
        self.wait_for_step("brew")
        self.runtime.failures.force_fail_next = True
        self.wait_for("FAILED")
        after_failure = {item["materialId"]: item for item in self.runtime.inventory_snapshot()["materials"]}
        self.assertEqual(after_failure["beans"]["onHand"], 30)

        self.assertTrue(self.runtime.command("retry")["ok"])
        self.wait_for("SUCCEEDED")
        after_retry = {item["materialId"]: item for item in self.runtime.inventory_snapshot()["materials"]}
        self.assertEqual(after_retry["beans"]["onHand"], 20)
        consumed_keys = self.runtime.inventory.state["consumedKeys"]
        brew_keys = [key for key in consumed_keys if ":brew:" in key]
        self.assertEqual(len(brew_keys), 2)
        self.assertTrue(any(key.endswith(":1") for key in brew_keys))
        self.assertTrue(any(key.endswith(":2") for key in brew_keys))

    def test_restart_recovers_task_and_duplicate_task_is_not_executed_again(self) -> None:
        self.runtime.runtime["override"]["offline"] = True
        command = {"messageId": "local-persist-1", "type": "MAKE_DRINK", "taskId": "task-persist-1", "orderId": "order-persist-1", "recipeId": "coffee-v1"}
        self.assertTrue(self.runtime._accept_task(command)["ok"])
        reserved_before = {item["materialId"]: item["reserved"] for item in self.runtime.inventory_snapshot()["materials"]}
        self.assertEqual(reserved_before, {"beans": 10.0, "cup": 1.0})

        self.runtime.close()
        self.runtime = CoffeeDeviceRuntime(self.config, self.instance)
        recovered = self.runtime.runtime.get("task") or {}
        self.assertEqual(recovered.get("taskId"), "task-persist-1")
        self.assertEqual(recovered.get("state"), "ACKNOWLEDGED")
        reserved_after = {item["materialId"]: item["reserved"] for item in self.runtime.inventory_snapshot()["materials"]}
        self.assertEqual(reserved_after, reserved_before)

        self.wait_for("SUCCEEDED")
        inventory_after_success = {item["materialId"]: item["onHand"] for item in self.runtime.inventory_snapshot()["materials"]}
        duplicate = self.runtime._accept_task({**command, "messageId": "local-persist-2"})
        self.assertTrue(duplicate["ok"])
        self.assertTrue(duplicate["duplicate"])
        conflict = self.runtime._accept_task({**command, "messageId": "local-persist-3", "recipeId": "strong-v1"})
        self.assertFalse(conflict["ok"])
        self.assertEqual(conflict["error"], "TASK_ID_CONFLICT")
        time.sleep(0.2)
        self.assertEqual({item["materialId"]: item["onHand"] for item in self.runtime.inventory_snapshot()["materials"]}, inventory_after_success)

    def test_cancel_requires_matching_task_and_local_api_rejects_browser_style_write(self) -> None:
        self.runtime.runtime["override"]["offline"] = True
        self.assertTrue(self.runtime._accept_task({"messageId": "local-cancel", "type": "MAKE_DRINK", "taskId": "task-current", "recipeId": "coffee-v1"})["ok"])
        rejected = self.runtime._apply_command("cancel", "task-old")
        self.assertFalse(rejected["ok"])
        self.assertEqual(rejected["reasonCode"], "TASK_MISMATCH")
        self.assertEqual(self.runtime.runtime["task"]["state"], "ACKNOWLEDGED")

        port = self.runtime.local_api.server.server_port
        request = Request(
            f"http://127.0.0.1:{port}/device/v1/inventory/adjustments",
            data=b'{"materialId":"beans","mode":"SET","amount":0}',
            method="POST",
        )
        with self.assertRaises(HTTPError) as caught:
            urlopen(request, timeout=2)
        self.assertEqual(caught.exception.code, 415)

    def test_remote_restart_holds_recovered_task_for_reconciliation(self) -> None:
        self.runtime.runtime["override"]["offline"] = True
        command = {"messageId": "local-remote-recovery", "type": "MAKE_DRINK", "taskId": "task-remote-recovery", "recipeId": "coffee-v1"}
        self.assertTrue(self.runtime._accept_task(command)["ok"])
        self.runtime.close()

        self.config["backend"].update({"mode": "remote", "baseUrl": "http://127.0.0.1:1", "requestTimeoutSeconds": 0.1, "commandPollSeconds": 0.1, "heartbeatIntervalSeconds": 0.1})
        self.runtime = CoffeeDeviceRuntime(self.config, self.instance)
        recovered = self.runtime.runtime["task"]
        self.assertEqual(recovered["state"], "PAUSED")
        self.assertEqual(recovered["recoveryPreviousState"], "ACKNOWLEDGED")
        self.assertEqual(self.runtime.runtime["deviceStatus"], "RECOVERING")
        time.sleep(0.4)
        self.assertEqual(self.runtime.runtime["task"]["state"], "PAUSED")

    def test_command_inbox_rejects_same_id_with_different_payload(self) -> None:
        command = {"messageId": "cmd-conflict", "type": "RELOAD_CONFIG"}
        self.assertEqual(self.runtime.store.record_command(command)[0], "NEW")
        self.assertEqual(self.runtime.store.record_command(dict(command))[0], "EXISTING")
        conflicting = {**command, "type": "INVENTORY_ADJUSTMENT", "payload": {"materialId": "beans", "mode": "SET", "amount": 0}}
        disposition, existing = self.runtime.store.record_command(conflicting)
        self.assertEqual(disposition, "CONFLICT")
        self.assertEqual(existing["type"], "RELOAD_CONFIG")

    def test_local_api_token_protects_write_endpoints(self) -> None:
        self.runtime.close()
        self.config["localApi"]["authToken"] = "local-secret"
        self.runtime = CoffeeDeviceRuntime(self.config, self.instance)
        port = self.runtime.local_api.server.server_port
        url = f"http://127.0.0.1:{port}/device/v1/inventory/adjustments"
        payload = b'{"materialId":"beans","mode":"SET","amount":25}'
        without_token = Request(url, data=payload, method="POST", headers={"Content-Type": "application/json"})
        with self.assertRaises(HTTPError) as caught:
            urlopen(without_token, timeout=2)
        self.assertEqual(caught.exception.code, 401)

        authorized = Request(url, data=payload, method="POST", headers={"Content-Type": "application/json", "X-Local-Token": "local-secret"})
        with urlopen(authorized, timeout=2) as response:
            result = json.load(response)
        self.assertTrue(result["ok"])
        self.assertEqual(result["change"]["after"], 25)


if __name__ == "__main__":
    unittest.main()
