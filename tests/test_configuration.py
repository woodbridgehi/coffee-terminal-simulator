from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "coffee-terminal"))

from configuration import load_config, load_env_file, read_env_values, write_env_values  # noqa: E402


class ConfigurationTest(unittest.TestCase):
    def test_environment_overrides_remote_secret_without_changing_json(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "device.json"
            path.write_text(json.dumps({"deviceId": "coffee-bot-002", "backend": {"baseUrl": "http://old"}}), encoding="utf-8")
            with patch.dict(os.environ, {"COFFEE_BACKEND_BASE_URL": "https://coffee-api.example/", "COFFEE_DEVICE_TOKEN": "secret"}, clear=False):
                config = load_config(path)
            self.assertEqual(config["backend"]["baseUrl"], "https://coffee-api.example")
            self.assertEqual(config["backend"]["authToken"], "secret")
            self.assertNotIn("secret", path.read_text(encoding="utf-8"))

    def test_transport_is_normalized_and_restricted(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "device.json"
            path.write_text(json.dumps({"deviceId": "coffee-bot-002", "backend": {}}), encoding="utf-8")
            with patch.dict(os.environ, {"COFFEE_TRANSPORT": " MQTT5 "}, clear=False):
                config = load_config(path)
            self.assertEqual(config["backend"]["transport"], "mqtt5")

            path.write_text(json.dumps({"deviceId": "coffee-bot-002", "backend": {"transport": "udp"}}), encoding="utf-8")
            with self.assertRaises(ValueError):
                load_config(path)

    def test_missing_transport_keeps_http_compatibility(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "device.json"
            path.write_text(json.dumps({"deviceId": "coffee-bot-002", "backend": {}}), encoding="utf-8")
            with patch.dict(os.environ, {"COFFEE_TRANSPORT": ""}, clear=False):
                config = load_config(path)
            self.assertEqual(config["backend"]["transport"], "http")

    def test_local_mode_uses_local_transport_marker(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "device.json"
            path.write_text(json.dumps({"deviceId": "coffee-bot-002", "backend": {"mode": "local"}}), encoding="utf-8")
            config = load_config(path)
            self.assertEqual(config["backend"]["transport"], "local")

    def test_env_file_rejects_malformed_line(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "device.env"
            path.write_text("INVALID\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                load_env_file(path)

    def test_secret_env_is_written_atomically_with_owner_only_permissions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "device.env"
            write_env_values(path, {"COFFEE_DEVICE_TOKEN": "secret", "COFFEE_BACKEND_BASE_URL": "https://example.test"})
            self.assertEqual(read_env_values(path)["COFFEE_DEVICE_TOKEN"], "secret")
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
