from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse


class DeviceApiServer:
    def __init__(self, runtime: Any, host: str, port: int) -> None:
        self.runtime = runtime

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args: Any) -> None:
                return

            def send_json(self, status: int, payload: dict[str, Any]) -> None:
                raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def body(self) -> dict[str, Any]:
                length = int(self.headers.get("Content-Length", "0"))
                return json.loads(self.rfile.read(length).decode("utf-8")) if length else {}

            def do_GET(self) -> None:
                path = urlparse(self.path).path
                routes = {
                    "/device/v1/health": runtime.health,
                    "/device/v1/capabilities": runtime.capabilities,
                    "/device/v1/inventory": runtime.inventory_snapshot,
                    "/device/v1/status": runtime.status,
                }
                handler = routes.get(path)
                self.send_json(200, handler()) if handler else self.send_json(404, {"ok": False, "error": "NOT_FOUND"})

            def do_POST(self) -> None:
                path = urlparse(self.path).path
                try:
                    if path == "/device/v1/inventory/adjustments":
                        result = runtime.adjust_inventory(self.body())
                    elif path == "/device/v1/config/reload":
                        result = runtime.reload_config()
                    else:
                        self.send_json(404, {"ok": False, "error": "NOT_FOUND"})
                        return
                    self.send_json(200 if result.get("ok") else 400, result)
                except (ValueError, json.JSONDecodeError) as exc:
                    self.send_json(400, {"ok": False, "error": str(exc)})

        self.server = ThreadingHTTPServer((host, port), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
