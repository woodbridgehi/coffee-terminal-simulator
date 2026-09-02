from __future__ import annotations

import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "coffee-terminal"))

from cloud import CloudClient  # noqa: E402


class CloudClientIdentityTest(unittest.TestCase):
    def test_get_retries_an_incomplete_response_once(self) -> None:
        attempts = 0

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args: object) -> None:
                return

            def do_GET(self) -> None:
                nonlocal attempts
                attempts += 1
                raw = json.dumps({"status": "PAIRED"}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                if attempts > 1:
                    self.wfile.write(raw)

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            client = CloudClient({
                "deviceId": "device-1",
                "backend": {"baseUrl": f"http://127.0.0.1:{server.server_port}"},
            })
            result = client.request("GET", "/pairing-status")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

        self.assertEqual(result, {"status": "PAIRED"})
        self.assertEqual(attempts, 2)

    def test_activation_and_rotation_contracts(self) -> None:
        received: list[tuple[str, dict[str, str], dict]] = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args: object) -> None:
                return

            def do_POST(self) -> None:
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length))
                received.append((self.path, dict(self.headers), body))
                raw = json.dumps({"deviceId": "device-1", "version": 2}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            client = CloudClient({
                "deviceId": "device-1",
                "backend": {"baseUrl": f"http://127.0.0.1:{server.server_port}", "authToken": "old-token"},
            })
            client.activate("one-time-code", "n" * 48)
            client.rotate_credential("r" * 48, "rotate-request-1")
            client.rotate_mqtt_credential()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

        self.assertEqual(received[0][0], "/api/v1/device-activations")
        self.assertEqual(received[0][2]["deviceToken"], "n" * 48)
        self.assertEqual(received[1][0], "/api/v1/devices/device-1/credentials/rotate")
        self.assertEqual(received[1][1]["Idempotency-Key"], "rotate-request-1")
        self.assertEqual(received[1][2]["newToken"], "r" * 48)
        self.assertEqual(received[2][0], "/api/v1/devices/device-1/mqtt-credentials/rotate")


if __name__ == "__main__":
    unittest.main()
