from __future__ import annotations

import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class CloudError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None, retryable: bool = True) -> None:
        super().__init__(message)
        self.status = status
        self.retryable = retryable


class CloudClient:
    def __init__(self, config: dict[str, Any]) -> None:
        self.device_id = str(config.get("deviceId") or "")
        backend = config.get("backend", {})
        self.base_url = backend.get("baseUrl", "").rstrip("/")
        self.timeout = float(backend.get("requestTimeoutSeconds", 5))
        self.headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": backend.get("userAgent", "CoffeeTerminalSimulator/1.2.0"),
            "X-Device-Id": self.device_id,
            **backend.get("headers", {}),
        }
        if backend.get("authToken"):
            self.headers["Authorization"] = f"Bearer {backend['authToken']}"

    def request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = {**self.headers, **(extra_headers or {})}
        request = Request(f"{self.base_url}{path}", data=body, method=method, headers=headers)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except HTTPError as exc:
            retryable = exc.code in {408, 425, 429} or 500 <= exc.code <= 599
            raise CloudError(str(exc), status=exc.code, retryable=retryable) from exc
        except json.JSONDecodeError as exc:
            raise CloudError(f"后台响应不是有效 JSON：{exc}", retryable=False) from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise CloudError(str(exc), retryable=True) from exc

    def commands(self, cursor: str | None) -> dict[str, Any]:
        query = urlencode({"after": cursor or "", "limit": 10})
        return self.request("GET", f"/api/v1/devices/{self.device_id}/commands?{query}")

    def ack(self, task_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", f"/api/v1/tasks/{task_id}/ack", payload)

    def command_result(self, message_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", f"/api/v1/devices/{self.device_id}/commands/{message_id}/result", payload)

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

    def onboarding_options(self) -> dict[str, Any]:
        return self.request("GET", "/api/v1/device-onboarding/options")

    def activate(
        self, activation_code: str, device_token: str, profile: dict[str, Any] | None = None,
        serial_number: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "deviceId": self.device_id, "activationCode": activation_code, "deviceToken": device_token,
        }
        if serial_number is not None:
            payload["serialNumber"] = serial_number
        if profile is not None:
            payload["profile"] = profile
        return self.request("POST", "/api/v1/device-activations", payload)

    def rotate_credential(self, new_token: str, idempotency_key: str) -> dict[str, Any]:
        return self.request(
            "POST", f"/api/v1/devices/{self.device_id}/credentials/rotate",
            {"newToken": new_token}, {"Idempotency-Key": idempotency_key},
        )

    def rotate_mqtt_credential(self) -> dict[str, Any]:
        return self.request("POST", f"/api/v1/devices/{self.device_id}/mqtt-credentials/rotate", {})

    def debug_order(self, recipe_id: str, requested_at: str) -> dict[str, Any]:
        return self.request("POST", f"/api/v1/devices/{self.device_id}/debug/orders", {"deviceId": self.device_id, "recipeId": recipe_id, "source": "terminal-console", "requestedAt": requested_at})

    def debug_command(self, action: str, requested_at: str) -> dict[str, Any]:
        return self.request("POST", f"/api/v1/devices/{self.device_id}/debug/commands", {"deviceId": self.device_id, "action": action, "requestedAt": requested_at})

    def debug_overrides(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self.request("PATCH", f"/api/v1/devices/{self.device_id}/debug/overrides", payload)
