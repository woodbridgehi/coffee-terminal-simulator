#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "coffee-terminal"))

from cloud import CloudClient, CloudError  # noqa: E402
from configuration import read_env_values, write_env_values  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Issue/rotate one device MQTT credential without printing secrets")
    parser.add_argument("instance")
    parser.add_argument("--secrets-file", type=Path)
    args = parser.parse_args()

    instance = args.instance.removesuffix(".json")
    config_path = ROOT / "config" / "instances" / instance / "device.json"
    secret_path = (args.secrets_file or (ROOT / ".secrets" / f"{instance}.env")).resolve()
    pending_path = secret_path.with_name(f"{secret_path.name}.mqtt-rotation-pending")
    if not config_path.exists() or not secret_path.exists():
        raise SystemExit("设备配置或凭证文件不存在")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    current = read_env_values(secret_path)
    device_token = current.get("COFFEE_DEVICE_TOKEN")
    if not device_token:
        raise SystemExit("凭证文件缺少 COFFEE_DEVICE_TOKEN")

    os.environ["COFFEE_DEVICE_TOKEN"] = device_token
    config.setdefault("backend", {})["authToken"] = device_token
    client = CloudClient(config)
    try:
        response = client.rotate_mqtt_credential()
    except CloudError as exc:
        raise SystemExit(f"MQTT 凭证轮换失败（HTTP {exc.status or '-'}）；原凭证文件未修改") from exc
    credential = response.get("mqttCredential")
    if not isinstance(credential, dict) or not credential.get("password"):
        raise SystemExit("云端未返回一次性 MQTT 凭证；原凭证文件未修改")
    pending = {
        **current,
        "COFFEE_TRANSPORT": "mqtt5",
        "MQTT_HOST": str(credential.get("host") or "mqtt-api.woodbridge.top"),
        "MQTT_PORT": str(credential.get("port") or 8883),
        "MQTT_USERNAME": str(credential.get("username") or config["deviceId"]),
        "MQTT_PASSWORD": str(credential["password"]),
    }
    write_env_values(pending_path, pending)
    pending_path.replace(secret_path)
    secret_path.chmod(0o600)
    print(f"设备 {config['deviceId']} MQTT 凭证已轮换至版本 {credential.get('version')}，密钥未输出。")


if __name__ == "__main__":
    main()
