from __future__ import annotations

import json
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "coffee-terminal"))

from backend import CoffeeDeviceRuntime  # noqa: E402


class CloudIntegrationTest(unittest.TestCase):
    @staticmethod
    def make_instance(root: Path) -> None:
        (root / "recipes").mkdir()
        (root / "state").mkdir()
        (root / "materials.json").write_text(json.dumps({"materials": [{"materialId": "beans", "name": "Beans", "unit": "g", "capacity": 100, "initialOnHand": 50, "lowThreshold": 10, "criticalThreshold": 2, "enabled": True}]}), encoding="utf-8")
        (root / "failures.json").write_text(json.dumps({"globalFailureRate": 0, "profiles": {}, "stepOverrides": {}}), encoding="utf-8")
        (root / "recipes" / "espresso.json").write_text(json.dumps({"recipeId": "espresso-v1", "skuCode": "ESPRESSO", "version": "1.0.0", "name": "Espresso", "steps": [{"id": "brew", "name": "Brew", "durationSeconds": 0.05, "consumes": [{"materialId": "beans", "amount": 10, "unit": "g"}]}]}), encoding="utf-8")

    def test_remote_mode_polls_executes_and_syncs(self) -> None:
        received: list[tuple[str, str, dict]] = []
        command_sent = False

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args: object) -> None:
                return

            def respond(self, payload: dict) -> None:
                raw = json.dumps(payload).encode()
                self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)

            def do_GET(self) -> None:
                nonlocal command_sent
                path = urlparse(self.path).path
                received.append(("GET", path, {}))
                if path.endswith("/commands"):
                    commands = [] if command_sent else [{"messageId": "cmd-1", "type": "MAKE_DRINK", "taskId": "task-1", "orderId": "order-1", "recipeId": "espresso-v1", "recipeVersion": "1.0.0"}]
                    command_sent = True; self.respond({"commands": commands, "nextCursor": "1"})
                elif path.endswith("/display-config"):
                    self.respond({"qrUrl": "https://orders.example.test/device/test-device"})
                else:
                    self.respond({})

            def write_request(self) -> None:
                length = int(self.headers.get("Content-Length", "0")); payload = json.loads(self.rfile.read(length)) if length else {}
                received.append((self.command, urlparse(self.path).path, payload)); self.respond({"ok": True})

            do_POST = write_request
            do_PUT = write_request
            do_PATCH = write_request

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        temporary = tempfile.TemporaryDirectory(); instance = Path(temporary.name)
        (instance / "recipes").mkdir(); (instance / "state").mkdir()

        def write(relative: str, payload: dict) -> None:
            (instance / relative).write_text(json.dumps(payload), encoding="utf-8")

        write("materials.json", {"materials": [{"materialId": "beans", "name": "Beans", "unit": "g", "capacity": 100, "initialOnHand": 50, "lowThreshold": 10, "criticalThreshold": 2, "enabled": True}]})
        write("failures.json", {"globalFailureRate": 0, "profiles": {}, "stepOverrides": {}})
        write("recipes/espresso.json", {"recipeId": "espresso-v1", "skuCode": "ESPRESSO", "version": "1.0.0", "name": "Espresso", "steps": [{"id": "brew", "name": "Brew", "durationSeconds": 0.05, "consumes": [{"materialId": "beans", "amount": 10, "unit": "g"}]}]})
        config = {"instanceId": "test-instance", "deviceId": "test-device", "deviceName": "TEST", "storeId": "test-store", "backend": {"mode": "remote", "baseUrl": f"http://127.0.0.1:{server.server_port}", "commandPollSeconds": 0.1, "heartbeatIntervalSeconds": 0.1, "requestTimeoutSeconds": 1}, "localApi": {"enabled": False}}
        runtime = CoffeeDeviceRuntime(config, instance)
        try:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                task = runtime.runtime.get("task") or {}
                paths = {(method, path) for method, path, _ in received}
                if task.get("state") == "SUCCEEDED" and ("POST", "/api/v1/devices/test-device/events") in paths:
                    break
                time.sleep(0.05)
            self.assertEqual((runtime.runtime.get("task") or {}).get("state"), "SUCCEEDED")
            paths = {(method, path) for method, path, _ in received}
            self.assertIn(("POST", "/api/v1/tasks/task-1/ack"), paths)
            self.assertIn(("PUT", "/api/v1/devices/test-device/capabilities"), paths)
            self.assertIn(("PUT", "/api/v1/devices/test-device/inventory"), paths)
            self.assertIn(("POST", "/api/v1/devices/test-device/heartbeat"), paths)
            self.assertEqual(runtime.inventory_snapshot()["materials"][0]["onHand"], 40)
        finally:
            runtime.close(); server.shutdown(); server.server_close(); thread.join(timeout=2); temporary.cleanup()

    def test_repeated_command_and_lost_ack_do_not_repeat_production(self) -> None:
        received_events: list[str] = []
        ack_attempts = 0

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args: object) -> None:
                return

            def respond(self, payload: object, status: int = 200) -> None:
                raw = json.dumps(payload).encode()
                self.send_response(status); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)

            def do_GET(self) -> None:
                path = urlparse(self.path).path
                if path.endswith("/commands"):
                    self.respond({"commands": [{"messageId": "cmd-stable", "type": "MAKE_DRINK", "taskId": "task-stable", "orderId": "order-stable", "recipeId": "espresso-v1", "recipeVersion": "1.0.0"}], "nextCursor": "stable"})
                else:
                    self.respond({})

            def do_POST(self) -> None:
                nonlocal ack_attempts
                length = int(self.headers.get("Content-Length", "0")); payload = json.loads(self.rfile.read(length)) if length else {}
                path = urlparse(self.path).path
                if path.endswith("/ack"):
                    ack_attempts += 1
                    self.respond({"ok": ack_attempts > 1}, status=500 if ack_attempts == 1 else 200)
                    return
                if path.endswith("/events"):
                    received_events.append(payload.get("type"))
                self.respond({"ok": True})

            def do_PUT(self) -> None:
                length = int(self.headers.get("Content-Length", "0")); self.rfile.read(length)
                self.respond({"ok": True})

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        temporary = tempfile.TemporaryDirectory(); instance = Path(temporary.name)
        self.make_instance(instance)
        config = {"instanceId": "test-retry", "deviceId": "test-retry", "deviceName": "TEST", "storeId": "test", "backend": {"mode": "remote", "baseUrl": f"http://127.0.0.1:{server.server_port}", "commandPollSeconds": 0.05, "heartbeatIntervalSeconds": 0.2, "requestTimeoutSeconds": 1}, "localApi": {"enabled": False}}
        runtime = CoffeeDeviceRuntime(config, instance)
        try:
            deadline = time.monotonic() + 6
            while time.monotonic() < deadline:
                if ack_attempts >= 2 and "task.succeeded" in received_events:
                    break
                time.sleep(0.05)
            self.assertGreaterEqual(ack_attempts, 2)
            self.assertEqual(received_events.count("task.started"), 1)
            self.assertEqual(received_events.count("task.succeeded"), 1)
            self.assertEqual(runtime.inventory_snapshot()["materials"][0]["onHand"], 40)
            self.assertEqual(runtime.store.command("cmd-stable")["deliveryState"], "SENT")
        finally:
            runtime.close(); server.shutdown(); server.server_close(); thread.join(timeout=2); temporary.cleanup()

    def test_malformed_command_response_is_isolated_and_worker_recovers(self) -> None:
        command_requests = 0

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args: object) -> None:
                return

            def respond(self, payload: object) -> None:
                raw = json.dumps(payload).encode()
                self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)

            def do_GET(self) -> None:
                nonlocal command_requests
                path = urlparse(self.path).path
                if path.endswith("/commands"):
                    command_requests += 1
                    if command_requests == 1:
                        self.respond([])
                    else:
                        self.respond({"commands": [], "nextCursor": "ok"})
                else:
                    self.respond({})

            def write_request(self) -> None:
                length = int(self.headers.get("Content-Length", "0")); self.rfile.read(length)
                self.respond({"ok": True})

            do_POST = write_request
            do_PUT = write_request

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        temporary = tempfile.TemporaryDirectory(); instance = Path(temporary.name)
        self.make_instance(instance)
        config = {"instanceId": "test-malformed", "deviceId": "test-malformed", "deviceName": "TEST", "storeId": "test", "backend": {"mode": "remote", "baseUrl": f"http://127.0.0.1:{server.server_port}", "commandPollSeconds": 0.05, "heartbeatIntervalSeconds": 0.1, "requestTimeoutSeconds": 1}, "localApi": {"enabled": False}}
        runtime = CoffeeDeviceRuntime(config, instance)
        try:
            deadline = time.monotonic() + 4
            while time.monotonic() < deadline and (command_requests < 2 or runtime.runtime["connection"] != "ONLINE"):
                time.sleep(0.05)
            self.assertGreaterEqual(command_requests, 2)
            self.assertTrue(runtime.sync_health["threadAlive"])
            self.assertEqual(runtime.runtime["connection"], "ONLINE")
        finally:
            runtime.close(); server.shutdown(); server.server_close(); thread.join(timeout=2); temporary.cleanup()


if __name__ == "__main__":
    unittest.main()
