#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
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
    if args.env_file:
        load_env_file(args.env_file.resolve())
    config = INSTANCES / args.instance.removesuffix(".json") / "device.json"
    if not config.exists():
        raise SystemExit(f"配置不存在：{config}")
    command = [str(PYTHON), str(APP), "--config", str(config)]
    if args.debug:
        command.append("--debug")
    raise SystemExit(subprocess.call(command, cwd=str(ROOT)))


if __name__ == "__main__":
    main()
