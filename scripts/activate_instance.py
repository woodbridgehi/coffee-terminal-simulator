#!/usr/bin/env python3
from __future__ import annotations

import argparse
import secrets
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "coffee-terminal"))

from cloud import CloudClient, CloudError  # noqa: E402
from configuration import read_env_values, write_env_values  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Activate one simulator instance without printing credentials")
    parser.add_argument("instance")
    parser.add_argument("--activation-code-file", type=Path, required=True)
    parser.add_argument("--secrets-file", type=Path)
    args = parser.parse_args()

    instance = args.instance.removesuffix(".json")
    config_path = ROOT / "config" / "instances" / instance / "device.json"
    if not config_path.exists():
        raise SystemExit(f"配置不存在：{config_path}")
    import json
    config = json.loads(config_path.read_text(encoding="utf-8"))
    secret_path = (args.secrets_file or (ROOT / ".secrets" / f"{instance}.env")).resolve()
    pending_path = secret_path.with_name(f"{secret_path.name}.activation-pending")
    activation_code = args.activation_code_file.read_text(encoding="utf-8").strip()
    if not activation_code:
        raise SystemExit("激活码文件为空")

    if pending_path.exists():
        pending = read_env_values(pending_path)
        new_token = pending["COFFEE_DEVICE_TOKEN"]
    else:
        pending = read_env_values(secret_path)
        new_token = secrets.token_urlsafe(48)
        pending["COFFEE_DEVICE_TOKEN"] = new_token
        write_env_values(pending_path, pending)

    client = CloudClient(config)
    try:
        response = client.activate(activation_code, new_token)
    except CloudError as exc:
        raise SystemExit(f"激活失败（HTTP {exc.status or '-'}）；待提交凭证保留在受限文件中，可重试") from exc
    if response.get("deviceId") != config["deviceId"]:
        raise SystemExit("激活响应设备标识不匹配，未更新当前凭证")
    mqtt_credential = response.get("mqttCredential")
    if not isinstance(mqtt_credential, dict) or not mqtt_credential.get("password"):
        client.headers["Authorization"] = f"Bearer {new_token}"
        try:
            mqtt_credential = client.rotate_mqtt_credential().get("mqttCredential")
        except CloudError as exc:
            raise SystemExit(f"HTTP 激活已完成，但 MQTT 凭证签发失败（HTTP {exc.status or '-'}）；可重新运行本命令恢复") from exc
    if isinstance(mqtt_credential, dict) and mqtt_credential.get("password"):
        pending.update({
            "COFFEE_TRANSPORT": "mqtt5",
            "MQTT_HOST": str(mqtt_credential.get("host") or "mqtt-api.woodbridge.top"),
            "MQTT_PORT": str(mqtt_credential.get("port") or 8883),
            "MQTT_USERNAME": str(mqtt_credential.get("username") or config["deviceId"]),
            "MQTT_PASSWORD": str(mqtt_credential["password"]),
        })
        write_env_values(pending_path, pending)
    pending_path.replace(secret_path)
    secret_path.chmod(0o600)
    print(f"设备 {config['deviceId']} 已激活；凭证版本 {response.get('version')}，密钥未输出。")


if __name__ == "__main__":
    main()
