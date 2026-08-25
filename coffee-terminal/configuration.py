from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any
import json


def load_env_file(path: Path) -> None:
    """Load a simple KEY=VALUE secret file without logging its contents."""
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"{path}:{line_number}: expected KEY=VALUE")
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or not key.replace("_", "").isalnum():
            raise ValueError(f"{path}:{line_number}: invalid environment variable name")
        os.environ[key] = value.strip()


def load_config(path: Path) -> dict[str, Any]:
    config = json.loads(path.read_text(encoding="utf-8"))
    backend = config.setdefault("backend", {})

    if value := os.environ.get("COFFEE_BACKEND_BASE_URL"):
        backend["baseUrl"] = value.rstrip("/")
    if value := os.environ.get("COFFEE_DEVICE_TOKEN"):
        backend["authToken"] = value
    if value := os.environ.get("COFFEE_HEARTBEAT_INTERVAL_SECONDS"):
        backend["heartbeatIntervalSeconds"] = float(value)
    if value := os.environ.get("COFFEE_COMMAND_POLL_SECONDS"):
        backend["commandPollSeconds"] = float(value)
    if value := os.environ.get("COFFEE_REQUEST_TIMEOUT_SECONDS"):
        backend["requestTimeoutSeconds"] = float(value)
    if value := os.environ.get("COFFEE_TRANSPORT"):
        backend["transport"] = value
    mqtt = backend.setdefault("mqtt", {})
    mqtt_env = {
        "MQTT_HOST": ("host", str), "MQTT_PORT": ("port", int),
        "MQTT_USERNAME": ("username", str), "MQTT_PASSWORD": ("password", str),
        "MQTT_KEEPALIVE_SECONDS": ("keepaliveSeconds", int),
        "MQTT_SESSION_EXPIRY_SECONDS": ("sessionExpirySeconds", int),
        "MQTT_PROXY_HOST": ("proxyHost", str), "MQTT_PROXY_PORT": ("proxyPort", int),
        "MQTT_PROXY_TYPE": ("proxyType", str),
        "MQTT_CONNECT_HOST": ("connectHost", str), "MQTT_CONNECT_PORT": ("connectPort", int),
    }
    for env_name, (field, converter) in mqtt_env.items():
        if value := os.environ.get(env_name):
            mqtt[field] = converter(value)

    config["_configPath"] = str(path)
    return config


def read_env_values(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"{path}:{line_number}: expected KEY=VALUE")
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def write_env_values(path: Path, values: dict[str, str]) -> None:
    """Atomically write a chmod-0600 env file without echoing secrets."""
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [f"{key}={value}" for key, value in sorted(values.items())]
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write("\n".join(lines) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()
