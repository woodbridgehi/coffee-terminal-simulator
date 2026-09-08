from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse


class DeviceApiServer:
    def __init__(self, runtime: Any, host: str, port: int, *, settings: dict[str, Any] | None = None, environment: str = "development") -> None:
        self.runtime = runtime
        settings = settings or {}
        auth_token = str(settings.get("authToken") or "")
        max_body_bytes = int(settings.get("maxBodyBytes", 64 * 1024))
        allowed_origins = set(settings.get("allowedOrigins", []))
        loopback_hosts = {"127.0.0.1", "localhost", "::1"}
        if host not in loopback_hosts and not auth_token:
            raise ValueError("本地 API 绑定非回环地址时必须配置 authToken")
        if environment.lower() == "production" and not auth_token:
            raise ValueError("生产环境启用本地 API 时必须配置 authToken")

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

            def request_host(self) -> str:
                raw = self.headers.get("Host", "")
                if raw.startswith("["):
                    return raw[1:].split("]", 1)[0]
                return raw.rsplit(":", 1)[0] if raw.count(":") == 1 else raw

            def validate_host(self) -> bool:
                return self.request_host() in loopback_hosts | {host}

            def authorize_write(self) -> bool:
                if not self.validate_host():
                    self.send_json(403, {"ok": False, "error": "HOST_NOT_ALLOWED"})
                    return False
                origin = self.headers.get("Origin")
                if origin and origin not in allowed_origins:
                    self.send_json(403, {"ok": False, "error": "ORIGIN_NOT_ALLOWED"})
                    return False
                if auth_token and self.headers.get("X-Local-Token") != auth_token:
                    self.send_json(401, {"ok": False, "error": "UNAUTHORIZED"})
                    return False
                content_type = self.headers.get("Content-Type", "")
                if not content_type.lower().startswith("application/json"):
                    self.send_json(415, {"ok": False, "error": "JSON_CONTENT_TYPE_REQUIRED"})
                    return False
                return True

            def body(self) -> dict[str, Any]:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 0:
                    raise ValueError("Content-Length 不能为负数")
                if length > max_body_bytes:
                    raise OverflowError(f"请求体超过 {max_body_bytes} 字节")
                return json.loads(self.rfile.read(length).decode("utf-8")) if length else {}

            def do_GET(self) -> None:
                if not self.validate_host():
                    self.send_json(403, {"ok": False, "error": "HOST_NOT_ALLOWED"})
                    return
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
                    if not self.authorize_write():
                        return
                    if path == "/device/v1/inventory/adjustments":
                        result = runtime.adjust_inventory(self.body())
                    elif path == "/device/v1/config/reload":
                        result = runtime.reload_config()
                    elif path == '/device/v1/pickup/confirm':
                        result = runtime.confirm_pickup(self.body().get('taskId'))
                    else:
                        self.send_json(404, {"ok": False, "error": "NOT_FOUND"})
                        return
                    self.send_json(200 if result.get("ok") else 400, result)
                except OverflowError as exc:
                    self.send_json(413, {"ok": False, "error": str(exc)})
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
