#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "coffee-terminal"))

from cloud import CloudClient, CloudError  # noqa: E402
from configuration import read_env_values, write_env_values  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Rotate one simulator credential with crash-safe local promotion")
    parser.add_argument("instance")
    parser.add_argument("--secrets-file", type=Path)
    args = parser.parse_args()

    instance = args.instance.removesuffix(".json")
    config_path = ROOT / "config" / "instances" / instance / "device.json"
    secret_path = (args.secrets_file or (ROOT / ".secrets" / f"{instance}.env")).resolve()
    pending_path = secret_path.with_name(f"{secret_path.name}.rotation-pending")
    if not config_path.exists() or not secret_path.exists():
        raise SystemExit("设备配置或凭证文件不存在")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    current = read_env_values(secret_path)
    current_token = current.get("COFFEE_DEVICE_TOKEN")
    if not current_token:
        raise SystemExit("凭证文件缺少 COFFEE_DEVICE_TOKEN")

    if pending_path.exists():
        pending = read_env_values(pending_path)
    else:
        pending = dict(current)
        pending["COFFEE_DEVICE_TOKEN"] = secrets.token_urlsafe(48)
        pending["COFFEE_ROTATION_IDEMPOTENCY_KEY"] = f"rotate-{uuid.uuid4()}"
        write_env_values(pending_path, pending)

    os.environ["COFFEE_DEVICE_TOKEN"] = current_token
    config.setdefault("backend", {})["authToken"] = current_token
    client = CloudClient(config)
    try:
        response = client.rotate_credential(
            pending["COFFEE_DEVICE_TOKEN"], pending["COFFEE_ROTATION_IDEMPOTENCY_KEY"],
        )
    except CloudError as exc:
        raise SystemExit(f"轮换失败（HTTP {exc.status or '-'}）；待提交凭证已保留，可安全重试") from exc
    pending.pop("COFFEE_ROTATION_IDEMPOTENCY_KEY", None)
    write_env_values(pending_path, pending)
    pending_path.replace(secret_path)
    secret_path.chmod(0o600)
    print(f"设备 {config['deviceId']} 凭证已轮换至版本 {response.get('version')}，密钥未输出。")


if __name__ == "__main__":
    main()
