from __future__ import annotations

import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class CloudError(RuntimeError):
    pass


class CloudClient:
    def __init__(self, config: dict[str, Any]) -> None:
        self.device_id = config["deviceId"]
        backend = config.get("backend", {})
        self.base_url = backend.get("baseUrl", "").rstrip("/")
        self.timeout = float(backend.get("requestTimeoutSeconds", 5))
        self.headers = {"Accept": "application/json", "Content-Type": "application/json", "X-Device-Id": self.device_id, **backend.get("headers", {})}
        if backend.get("authToken"):
            self.headers["Authorization"] = f"Bearer {backend['authToken']}"

    def request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = Request(f"{self.base_url}{path}", data=body, method=method, headers=self.headers)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except (HTTPError, URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            raise CloudError(str(exc)) from exc

    def commands(self, cursor: str | None) -> dict[str, Any]:
        query = urlencode({"after": cursor or "", "limit": 10})
        return self.request("GET", f"/api/v1/devices/{self.device_id}/commands?{query}")

    def ack(self, task_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", f"/api/v1/tasks/{task_id}/ack", payload)

    def heartbeat(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", f"/api/v1/devices/{self.device_id}/heartbeat", payload)

    def sync_capabilities(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.request("PUT", f"/api/v1/devices/{self.device_id}/capabilities", payload)

    def sync_inventory(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.request("PUT", f"/api/v1/devices/{self.device_id}/inventory", payload)

    def send_event(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", f"/api/v1/devices/{self.device_id}/events", payload)

    def display_config(self) -> dict[str, Any]:
        return self.request("GET", f"/api/v1/devices/{self.device_id}/display-config")

    def debug_order(self, recipe_id: str, requested_at: str) -> dict[str, Any]:
        return self.request("POST", f"/api/v1/devices/{self.device_id}/debug/orders", {"deviceId": self.device_id, "recipeId": recipe_id, "source": "terminal-console", "requestedAt": requested_at})

    def debug_command(self, action: str, requested_at: str) -> dict[str, Any]:
        return self.request("POST", f"/api/v1/devices/{self.device_id}/debug/commands", {"deviceId": self.device_id, "action": action, "requestedAt": requested_at})

    def debug_overrides(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.request("PATCH", f"/api/v1/devices/{self.device_id}/debug/overrides", payload)
