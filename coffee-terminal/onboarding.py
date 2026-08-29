"""First-boot installation bridge for a simulator instance.

The device still needs a server-side pre-registration and one-time activation code.
This bridge only collects constrained deployment metadata and never exposes secrets to JS.
"""
from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cloud import CloudClient, CloudError
from configuration import read_env_values, write_config, write_env_values

NUMBER_RE = re.compile(r"^[0-9]{3,6}$")


class OnboardingAdapter:
    def __init__(self, config: dict[str, Any], config_path: Path, simulator_root: Path) -> None:
        self.config = config
        self.config_path = config_path
        self.instance_dir = config_path.parent
        self.simulator_root = simulator_root

    def get_setup_state(self) -> dict[str, Any]:
        backend = self.config.get("backend", {})
        return {
            "backendUrl": backend.get("baseUrl", ""),
            "instanceName": self.instance_dir.name,
            "deviceId": self.config.get("deviceId", ""),
            "serialNumber": self.config.get("serialNumber", ""),
            "deviceName": self.config.get("deviceName", ""),
            "storeName": self.config.get("storeName", ""),
            "storeDescription": self.config.get("storeDescription", ""),
            "cityCode": self.config.get("cityCode", "CN-SH"),
        }

    def get_options(self) -> dict[str, Any]:
        try:
            return CloudClient(self.config).onboarding_options()
        except CloudError as exc:
            return {"ok": False, "error": f"无法读取安装选项：{exc}"}

    @staticmethod
    def _number(value: Any, name: str) -> str:
        number = str(value or "").strip()
        if not NUMBER_RE.fullmatch(number):
            raise ValueError(f"{name}必须为 3 到 6 位数字")
        return number

    def complete_setup(self, raw: dict[str, Any]) -> dict[str, Any]:
        try:
            device_number = self._number(raw.get("deviceNumber"), "设备编号")
            store_number = self._number(raw.get("storeNumber"), "门店编号")
            year = int(raw.get("serialYear"))
            if not 2025 <= year <= 2035:
                raise ValueError("生产年份必须在 2025 到 2035 之间")
            activation_code = str(raw.get("activationCode") or "").strip()
            if len(activation_code) < 12:
                raise ValueError("请输入有效的一次性激活码")
            device_name = " ".join(str(raw.get("deviceName") or "").split())
            store_name = " ".join(str(raw.get("storeName") or "").split())
            store_description = " ".join(str(raw.get("storeDescription") or "").split())
            if not device_name or len(device_name) > 120:
                raise ValueError("设备展示名称为 1 到 120 个字符")
            if not store_name or len(store_name) > 120:
                raise ValueError("店铺名称为 1 到 120 个字符")
            if len(store_description) > 300:
                raise ValueError("店铺简介最多 300 个字符")

            device_id = f"coffee-bot-{device_number}"
            serial_number = f"CB-{year}-{device_number}"
            instance_id = f"instance-{device_id}"
            city_code = str(raw.get("cityCode") or "")

            # The server is the authority for the finite city/timezone catalogue.
            provisional = dict(self.config)
            provisional["deviceId"] = device_id
            client = CloudClient(provisional)
            options = client.onboarding_options()
            cities = {item.get("code"): item for item in options.get("cities", []) if isinstance(item, dict)}
            city = cities.get(city_code)
            if not city:
                raise ValueError("请选择受支持的城市")
            timezone = str(city.get("timezone") or "")
            city_slug = city_code.lower()
            store_id = f"store-{city_slug}-{store_number}"
            profile = {
                "deviceName": device_name,
                "storeId": store_id,
                "storeName": store_name,
                "storeDescription": store_description,
                "cityCode": city_code,
                "timezone": timezone,
            }

            secret_path = self.simulator_root / ".secrets" / f"{self.instance_dir.name}.env"
            pending_path = secret_path.with_name(f"{secret_path.name}.activation-pending")
            pending = read_env_values(pending_path if pending_path.exists() else secret_path)
            device_token = pending.get("COFFEE_DEVICE_TOKEN")
            if not device_token:
                device_token = secrets.token_urlsafe(48)
                pending["COFFEE_DEVICE_TOKEN"] = device_token
                write_env_values(pending_path, pending)

            response = client.activate(activation_code, device_token, profile, serial_number=serial_number)
            if response.get("deviceId") != device_id:
                raise ValueError("激活响应中的设备编号不匹配")
            mqtt_credential = response.get("mqttCredential")
            if not isinstance(mqtt_credential, dict) or not mqtt_credential.get("password"):
                client.headers["Authorization"] = f"Bearer {device_token}"
                mqtt_credential = client.rotate_mqtt_credential().get("mqttCredential")
            if not isinstance(mqtt_credential, dict) or not mqtt_credential.get("password"):
                raise ValueError("HTTP 激活已完成，但 MQTT 凭证签发失败；请使用相同激活码重试")
            pending.update({
                "COFFEE_TRANSPORT": "mqtt5",
                "MQTT_HOST": str(mqtt_credential.get("host") or "mqtt-api.woodbridge.top"),
                "MQTT_PORT": str(mqtt_credential.get("port") or 8883),
                "MQTT_USERNAME": str(mqtt_credential.get("username") or device_id),
                "MQTT_PASSWORD": str(mqtt_credential["password"]),
            })
            write_env_values(pending_path, pending)

            # The server may contain administrator-provided values. Persist its final view.
            final_profile = response.get("profile") if isinstance(response.get("profile"), dict) else profile
            persisted = {key: value for key, value in self.config.items() if key != "_configPath"}
            persisted.update({
                "deviceId": device_id,
                "serialNumber": serial_number,
                "instanceId": instance_id,
                "deviceName": final_profile.get("deviceName") or device_name,
                "storeId": final_profile.get("storeId") or store_id,
                "storeName": final_profile.get("storeName") or store_name,
                "storeDescription": final_profile.get("storeDescription") or store_description,
                "cityCode": final_profile.get("cityCode") or city_code,
                "timezone": final_profile.get("timezone") or timezone,
                "registration": {
                    "status": "COMPLETED",
                    "completedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                    "profileSource": final_profile.get("source") or "DEVICE_ONBOARDING",
                },
            })
            # Promote credentials first. If persisting the non-secret profile then fails,
            # a retry reuses this credential and the server treats activation as idempotent.
            pending_path.replace(secret_path)
            secret_path.chmod(0o600)
            write_config(self.config_path, persisted)
            return {"ok": True, "deviceId": device_id, "deviceName": persisted["deviceName"]}
        except (CloudError, OSError, TypeError, ValueError) as exc:
            return {"ok": False, "error": str(exc)}
