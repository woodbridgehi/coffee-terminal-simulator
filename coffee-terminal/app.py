"""pywebview entry point for one independently configured coffee terminal."""
from __future__ import annotations

import argparse
import os
from pathlib import Path

import webview

from backend import CoffeeDeviceRuntime
from configuration import load_config, load_env_file
from macos_app_icon import set_macos_app_icon
from onboarding import OnboardingAdapter
from platform_paths import package_root, user_data_root

ROOT = package_root() / "coffee-terminal"
APP_ICON = ROOT.parent / "assets" / "coffee-bean.png"

def main() -> None:
    set_macos_app_icon(APP_ICON)
    icon_path = str(APP_ICON) if APP_ICON.is_file() else None
    parser = argparse.ArgumentParser(description="Coffee terminal instance")
    parser.add_argument("--config", required=True, type=Path, help="instance JSON config")
    parser.add_argument("--debug", action="store_true", help="enable pywebview debug tools")
    args = parser.parse_args()
    config_path = args.config.resolve()
    data_root = user_data_root()
    default_secrets = data_root / ".secrets" / f"{config_path.parent.name}.env"
    if default_secrets.exists() and not os.environ.get("COFFEE_DEVICE_TOKEN"):
        load_env_file(default_secrets)
    config = load_config(config_path)
    registration = config.get("registration") or {}
    needs_onboarding = (
        config.get("backend", {}).get("mode", "remote") == "remote"
        and registration.get("status") != "COMPLETED"
        and not config.get("backend", {}).get("authToken")
    )
    if needs_onboarding:
        adapter = OnboardingAdapter(config, config_path, data_root)
        window = webview.create_window(
            "Coffee Terminal · 首次安装", str(ROOT / "web" / "onboarding.html"),
            js_api=adapter, width=980, height=760, min_size=(640, 480),
        )
        webview.start(debug=args.debug, icon=icon_path)
        return
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
    window = webview.create_window(f"{config['deviceName']} · Coffee Terminal", str(ROOT / "web" / "index.html"), js_api=adapter, width=1440, height=900, min_size=(640, 480))
    window.events.closed += adapter.close
    webview.start(debug=args.debug, icon=icon_path)


if __name__ == "__main__":
    main()
