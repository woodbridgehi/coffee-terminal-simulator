#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import time
from pathlib import Path

import sys

ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / ".venv" / "bin" / "python"
APP = ROOT / "coffee-terminal" / "app.py"
INSTANCES = ROOT / "config" / "instances"
sys.path.insert(0, str(ROOT / "coffee-terminal"))

from configuration import load_env_file  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("instance", help="instance directory, e.g. coffee-bot-001")
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--env-file", type=Path, help="optional untracked KEY=VALUE file")
    args = parser.parse_args()
    instance_name = args.instance.removesuffix(".json")
    if args.env_file:
        load_env_file(args.env_file.resolve())
    else:
        default_secrets = ROOT / ".secrets" / f"{instance_name}.env"
        if default_secrets.exists():
            load_env_file(default_secrets)
    config = INSTANCES / instance_name / "device.json"
    if not config.exists():
        raise SystemExit(f"配置不存在：{config}")
    config_data = json.loads(config.read_text(encoding="utf-8"))
    local_api = config_data.get("localApi") or {}
    local_host = str(local_api.get("host") or "127.0.0.1")
    local_port = int(local_api.get("port") or 0)
    if local_api.get("enabled", True) and local_port and port_open(local_host, local_port):
        raise SystemExit(
            f"启动失败：{args.instance} 的本地 API {local_host}:{local_port} 已被占用。"
            f"\n请检查：lsof -nP -iTCP:{local_port} -sTCP:LISTEN"
            f"\n如果是旧进程，请停止后再执行 ./start-instance.command {args.instance}。"
        )
    command = [str(PYTHON), str(APP), "--config", str(config)]
    if args.debug:
        command.append("--debug")
    tunnel: subprocess.Popen[bytes] | None = None
    tunnel_target = os.environ.get("MQTT_SSH_TUNNEL_TARGET")
    connect_host = os.environ.get("MQTT_CONNECT_HOST")
    connect_port = int(os.environ.get("MQTT_CONNECT_PORT", "0") or 0)
    if tunnel_target and connect_host and connect_port and not port_open(connect_host, connect_port):
        remote_host = os.environ.get("MQTT_TUNNEL_REMOTE_HOST", "127.0.0.1")
        remote_port = int(os.environ.get("MQTT_TUNNEL_REMOTE_PORT", "8883"))
        tunnel = subprocess.Popen([
            "ssh", "-N", "-L", f"{connect_host}:{connect_port}:{remote_host}:{remote_port}",
            "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30", tunnel_target,
        ])
        for _ in range(300):
            if port_open(connect_host, connect_port):
                break
            if tunnel.poll() is not None:
                raise SystemExit("MQTT SSH 调试隧道启动失败")
            time.sleep(0.1)
        else:
            tunnel.terminate()
            raise SystemExit("MQTT SSH 调试隧道启动超时")
    try:
        return_code = subprocess.call(command, cwd=str(ROOT))
    except KeyboardInterrupt:
        return_code = 130
    finally:
        if tunnel and tunnel.poll() is None:
            tunnel.terminate()
    raise SystemExit(return_code)


def port_open(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.2):
            return True
    except OSError:
        return False


if __name__ == "__main__":
    main()
