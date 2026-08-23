#!/usr/bin/env python3
from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYTHON = ROOT / ".venv" / "bin" / "python"
APP = ROOT / "coffee-terminal" / "app.py"
INSTANCES = sorted((ROOT / "config" / "instances").glob("*/device.json"))


def main() -> None:
    if not INSTANCES:
        raise SystemExit("config/instances 下没有包含 device.json 的实例目录")
    processes = []
    try:
        for config in INSTANCES:
            processes.append(subprocess.Popen([str(PYTHON), str(APP), "--config", str(config)], cwd=str(ROOT)))
        print(f"已启动 {len(processes)} 个咖啡终端实例，按 Ctrl+C 关闭全部窗口。")
        for process in processes:
            process.wait()
    except KeyboardInterrupt:
        pass
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()


if __name__ == "__main__":
    main()
