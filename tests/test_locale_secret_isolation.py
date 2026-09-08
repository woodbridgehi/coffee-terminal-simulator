import json
import sys
import threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "coffee-terminal"))
from backend import CoffeeDeviceRuntime
from configuration import load_config, write_config


def test_locale_save_never_persists_runtime_credentials_or_overrides(tmp_path):
    path = tmp_path / "device.json"
    path.write_text(json.dumps({"backend": {"mode": "local", "baseUrl": "original"}}))
    with patch.dict("os.environ", {"COFFEE_DEVICE_TOKEN": "test-secret", "MQTT_PASSWORD": "test-password",
                                   "COFFEE_BACKEND_BASE_URL": "https://override.invalid"}, clear=True):
        config = load_config(path)
    runtime = SimpleNamespace(config=config, instance_dir=tmp_path, lock=threading.RLock())
    CoffeeDeviceRuntime.set_ui_locale(runtime, "en-US")
    saved = json.loads(path.read_text())
    assert saved["backend"] == {"mode": "local", "baseUrl": "original"}
    assert saved["ui"]["locale"] == "en-US"
    assert config["backend"]["authToken"] == "test-secret"
    write_config(path, config)
    assert "test-secret" not in path.read_text() and "test-password" not in path.read_text()
    assert config["backend"]["mqtt"]["password"] == "test-password"
