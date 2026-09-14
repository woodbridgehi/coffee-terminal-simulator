"""pywebview entry point for one independently configured coffee terminal."""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import webview

from backend import CoffeeDeviceRuntime
from configuration import load_config, load_env_file
from macos_app_icon import set_macos_app_icon
from onboarding import OnboardingAdapter
from platform_paths import package_root, user_data_root

ROOT = package_root() / "coffee-terminal"
APP_ICON = ROOT.parent / "assets" / "coffee-bean.png"
MIN_SPLASH_SECONDS = 1.35


def _startup_error(exc: BaseException, config: dict) -> str:
    local_api = config.get("localApi") or {}
    if isinstance(exc, OSError) and exc.errno in {48, 98, 10048} and local_api.get("port"):
        port = local_api["port"]
        return (
            f"启动失败：本地 API 端口 {local_api.get('host', '127.0.0.1')}:{port} 已被占用。"
            f" 请停止旧的 {config.get('deviceId', 'Coffee Terminal')} 进程后重试。"
        )
    return f"启动失败：{exc}"


def _show_startup_error(splash, message: str) -> None:
    try:
        splash.evaluate_js(f"window.startupFailed({json.dumps(message, ensure_ascii=False)})")
    except Exception:
        return


def _launch_application(
    splash,
    config: dict,
    config_path: Path,
    data_root: Path,
    windows_chrome: bool,
) -> None:
    splash.events.loaded.wait(10)
    started_at = time.monotonic()
    adapter = None
    window = None
    try:
        registration = config.get("registration") or {}
        needs_onboarding = (
            config.get("backend", {}).get("mode", "remote") == "remote"
            and registration.get("status") != "COMPLETED"
            and not config.get("backend", {}).get("authToken")
        )
        if needs_onboarding:
            adapter = OnboardingAdapter(config, config_path, data_root)
            title = "Coffee Terminal · 首次安装"
            page = ROOT / "web" / "onboarding.html"
            size = (1120, 820)
        else:
            adapter = CoffeeDeviceRuntime(config, config_path.parent)
            title = f"{config['deviceName']} · Coffee Terminal"
            page = ROOT / "web" / "index.html"
            size = (1440, 900)

        adapter._window_chrome_enabled = windows_chrome
        window = webview.create_window(
            title, str(page), js_api=adapter, width=size[0], height=size[1],
            min_size=(640, 480), hidden=True, frameless=windows_chrome,
            easy_drag=not windows_chrome, shadow=windows_chrome,
            background_color="#F6F0E5",
        )
        adapter._bind_window(window)
        if not needs_onboarding:
            window.events.closed += adapter.close
        if not window.events.loaded.wait(12):
            raise RuntimeError("主界面加载超时，请重新启动软件。")
        remaining = MIN_SPLASH_SECONDS - (time.monotonic() - started_at)
        if remaining > 0:
            time.sleep(remaining)
        window.show()
        splash.destroy()
    except Exception as exc:
        if window is not None:
            try:
                window.destroy()
            except Exception:
                pass
        if adapter is not None and hasattr(adapter, "close"):
            try:
                adapter.close()
            except Exception:
                pass
        _show_startup_error(splash, _startup_error(exc, config))


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
    windows_chrome = sys.platform == "win32"
    splash = webview.create_window(
        "Coffee Terminal", str(ROOT / "web" / "splash.html"),
        width=720, height=460, min_size=(520, 340), resizable=False,
        frameless=True, easy_drag=True, shadow=True, background_color="#F6F0E5",
    )
    webview.start(
        _launch_application,
        args=(splash, config, config_path, data_root, windows_chrome),
        debug=args.debug,
        icon=icon_path,
    )


if __name__ == "__main__":
    main()
