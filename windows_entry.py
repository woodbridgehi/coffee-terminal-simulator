"""Release entrypoint for the portable Windows Coffee Terminal build."""
from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path


APP_NAME = "CoffeeTerminal"


def package_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
    return Path(__file__).resolve().parent


def data_root() -> Path:
    override = os.environ.get("COFFEE_TERMINAL_DATA_ROOT")
    if override:
        return Path(override).expanduser()
    local_app_data = os.environ.get("LOCALAPPDATA")
    base = Path(local_app_data) if local_app_data else Path.home() / "AppData" / "Local"
    return base / APP_NAME


def ensure_default_instance(root: Path, destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    config_path = destination / "device.json"
    if config_path.exists():
        return config_path

    template_path = root / "config" / "device.bootstrap.template.json"
    demo_instance = root / "config" / "instances" / "coffee-bot-003"
    config = json.loads(template_path.read_text(encoding="utf-8"))
    config.setdefault("localApi", {})["port"] = 9103
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for filename in ("materials.json", "failures.json"):
        shutil.copy2(demo_instance / filename, destination / filename)
    shutil.copytree(demo_instance / "recipes", destination / "recipes", dirs_exist_ok=True)
    return config_path


def main() -> None:
    os.environ.setdefault("COFFEE_TERMINAL_SECURE_SECRETS", "1")
    os.environ.setdefault("COFFEE_TERMINAL_DATA_ROOT", str(data_root()))
    root = package_root()
    config_path = ensure_default_instance(root, Path(os.environ["COFFEE_TERMINAL_DATA_ROOT"]) / "instances" / "default")
    sys.path.insert(0, str(root / "coffee-terminal"))
    import app

    sys.argv = [sys.argv[0], "--config", str(config_path)]
    app.main()


if __name__ == "__main__":
    main()
