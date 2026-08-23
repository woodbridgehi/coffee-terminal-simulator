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


if __name__ == "__main__":
    unittest.main()
