"""Resource and per-user data paths shared by the Windows packaged entrypoint."""
from __future__ import annotations

import os
import sys
from pathlib import Path


def package_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
    return Path(__file__).resolve().parents[1]


def user_data_root() -> Path:
    override = os.environ.get("COFFEE_TERMINAL_DATA_ROOT")
    if override:
        return Path(override).expanduser()
    if os.name == "nt":
        local_app_data = os.environ.get("LOCALAPPDATA")
        base = Path(local_app_data) if local_app_data else Path.home() / "AppData" / "Local"
        return base / "CoffeeTerminal"
    return package_root()
