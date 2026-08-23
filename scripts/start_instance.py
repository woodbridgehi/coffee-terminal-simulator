#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / ".venv" / "bin" / "python"
APP = ROOT / "coffee-terminal" / "app.py"
INSTANCES = ROOT / "config" / "instances"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("instance", help="instance directory, e.g. coffee-bot-001")
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()
    config = INSTANCES / args.instance.removesuffix(".json") / "device.json"
    if not config.exists():
        raise SystemExit(f"配置不存在：{config}")
    command = [str(PYTHON), str(APP), "--config", str(config)]
    if args.debug:
        command.append("--debug")
    raise SystemExit(subprocess.call(command, cwd=str(ROOT)))


if __name__ == "__main__":
    main()
