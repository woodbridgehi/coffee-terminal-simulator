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
    adapter = CoffeeDeviceRuntime(config, config_path.parent)
    window = webview.create_window(f"{config['deviceName']} · Coffee Terminal", str(ROOT / "web" / "index.html"), js_api=adapter, width=1440, height=900, min_size=(1100, 700))
    window.events.closed += adapter.close
    webview.start(debug=args.debug)


if __name__ == "__main__":
    main()
