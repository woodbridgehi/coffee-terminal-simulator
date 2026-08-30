#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import signal
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "coffee-terminal"))

from backend import CoffeeDeviceRuntime  # noqa: E402
from configuration import load_config, load_env_file  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the real terminal runtime without pywebview")
    parser.add_argument("instance", help="instance directory, e.g. coffee-bot-002")
    parser.add_argument("--env-file", type=Path)
    parser.add_argument("--duration", type=float, default=0, help="exit after N seconds; 0 means until interrupted")
    parser.add_argument("--status-every", type=float, default=5)
    parser.add_argument("--resume-recovered", action="store_true", help="legacy option; remote recoveryHold tasks reject resume and require reconciliation")
    args = parser.parse_args()
    if args.env_file:
        load_env_file(args.env_file.resolve())
    config_path = ROOT / "config" / "instances" / args.instance / "device.json"
    config = load_config(config_path.resolve())
    runtime = CoffeeDeviceRuntime(config, config_path.parent)
    if args.resume_recovered and (runtime.runtime.get("task") or {}).get("state") == "PAUSED":
        result = runtime._apply_command("resume")
        if not result.get("ok"):
            runtime.close()
            raise SystemExit(f"恢复任务失败：{result.get('error')}")
    stopping = False

    def stop(*_: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    started = time.monotonic()
    next_status = 0.0
    try:
        while not stopping and (args.duration <= 0 or time.monotonic() - started < args.duration):
            if time.monotonic() >= next_status:
                status = runtime.status()
                print(json.dumps({"deviceId": status["deviceId"], "connection": status["connection"], "deviceStatus": status["deviceStatus"], "sync": status["sync"]}, ensure_ascii=False), flush=True)
                next_status = time.monotonic() + max(0.5, args.status_every)
            time.sleep(0.25)
    finally:
        runtime.close()


if __name__ == "__main__":
    main()
