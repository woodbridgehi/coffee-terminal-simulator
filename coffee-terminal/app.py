"""pywebview entry point for one independently configured coffee terminal."""
from __future__ import annotations

import argparse
from pathlib import Path

import webview

from backend import CoffeeDeviceRuntime
from configuration import load_config

ROOT = Path(__file__).resolve().parent

def main() -> None:
    parser = argparse.ArgumentParser(description="Coffee terminal instance")
    parser.add_argument("--config", required=True, type=Path, help="instance JSON config")
    parser.add_argument("--debug", action="store_true", help="enable pywebview debug tools")
    args = parser.parse_args()
    config_path = args.config.resolve()
    config = load_config(config_path)
    try:
        adapter = CoffeeDeviceRuntime(config, config_path.parent)
    except OSError as exc:
        local_api = config.get("localApi") or {}
        if exc.errno in {48, 98, 10048} and local_api.get("port"):
            port = local_api["port"]
            raise SystemExit(
                f"启动失败：本地 API 端口 {local_api.get('host', '127.0.0.1')}:{port} 已被占用。"
                f"\n请先检查：lsof -nP -iTCP:{port} -sTCP:LISTEN"
                f"\n如果是旧的 {config['deviceId']} 进程，请停止后再启动。"
            ) from exc
        raise
    window = webview.create_window(f"{config['deviceName']} · Coffee Terminal", str(ROOT / "web" / "index.html"), js_api=adapter, width=1440, height=900, min_size=(1100, 700))
    window.events.closed += adapter.close
    webview.start(debug=args.debug)


if __name__ == "__main__":
    main()
