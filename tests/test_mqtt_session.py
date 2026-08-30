"""Real-broker MQTT session lifecycle tests (B1.1).

These tests require a local plaintext test broker (default 127.0.0.1:51887).
They verify durable session behaviour, connection supervision, generation
ACK isolation and idempotent close. They intentionally never touch TLS or
production credentials.
"""
from __future__ import annotations

import json
import os
import queue
import socket
import subprocess
import threading
import time
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

import paho.mqtt.client as mqtt

PROJECT = Path(__file__).resolve().parents[1]
sys_path_added = str(PROJECT / "coffee-terminal")
import sys  # noqa: E402

if sys_path_added not in sys.path:
    sys.path.insert(0, sys_path_added)

from mqtt_transport import Mqtt5Transport, MqttTransportError  # noqa: E402

BROKER_HOST = os.getenv("MQTT_TEST_BROKER_HOST", "127.0.0.1")
BROKER_PORT = int(os.getenv("MQTT_TEST_BROKER_PORT", "51887"))
MOSQUITTO_BIN = os.getenv("MOSQUITTO_BIN", "/opt/homebrew/opt/mosquitto/sbin/mosquitto")


def _broker_available() -> bool:
    try:
        with socket.create_connection((BROKER_HOST, BROKER_PORT), timeout=1.0):
            return True
    except OSError:
        return False


pytestmark = pytest.mark.skipif(
    not _broker_available(),
    reason=f"local test broker not running on {BROKER_HOST}:{BROKER_PORT}",
)


@pytest.fixture()
def plaintext_broker(monkeypatch):
    """The production transport always enables TLS verification; the local test
    broker is plaintext, so neutralise tls_set for these tests only."""
    monkeypatch.setattr(mqtt.Client, "tls_set", lambda self, **_kwargs: None)


def broker_config() -> dict:
    return {
        "host": BROKER_HOST,
        "port": BROKER_PORT,
        "username": "device-test",
        "password": "device-test",
        "keepaliveSeconds": 10,
        "sessionExpirySeconds": 3600,
    }


def device_name() -> str:
    return f"device-{uuid.uuid4().hex[:10]}"


class HelperPublisher:
    """Independent MQTT5 client used to publish device downlink traffic."""

    def __init__(self) -> None:
        self.connected = threading.Event()
        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2, client_id=f"helper-{uuid.uuid4().hex[:8]}", protocol=mqtt.MQTTv5
        )
        self.client.on_connect = lambda *_args: self.connected.set()
        self.client.connect(BROKER_HOST, BROKER_PORT, keepalive=30)
        self.client.loop_start()
        assert self.connected.wait(timeout=10), "helper publisher failed to connect"

    def publish_command(self, device_id: str, message_id: str) -> None:
        payload = {"deviceId": device_id, "messageId": message_id, "type": "MAKE_DRINK", "action": {"kind": "brew"}}
        info = self.client.publish(f"v1/devices/{device_id}/down", json.dumps(payload), qos=1)
        info.wait_for_publish(timeout=5)
        assert info.is_published(), "helper publish was not acknowledged"

    def close(self) -> None:
        self.client.disconnect()
        self.client.loop_stop()


def wait_for_commands(transport: Mqtt5Transport, timeout: float = 10.0) -> list[dict]:
    deadline = time.monotonic() + timeout
    collected: list[dict] = []
    while time.monotonic() < deadline:
        collected.extend(transport.drain_commands(limit=50))
        if collected:
            return collected
        time.sleep(0.05)
    return collected


def paho_threads(prefix: str) -> list[threading.Thread]:
    return [t for t in threading.enumerate() if t.name.startswith(prefix) and t.is_alive()]


def wait_until(condition, timeout: float, message: str) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return
        time.sleep(0.05)
    raise AssertionError(message)


def test_offline_qos1_command_survives_transport_rebuild(plaintext_broker) -> None:
    """Persistent session must redeliver QoS1 downlink across process/object rebuilds."""
    device_id = device_name()
    first = Mqtt5Transport(device_id, broker_config())
    first.start()
    try:
        assert first.connected.wait(timeout=10), first.last_error
        # Round-trip probe: proves the broker has registered the subscription
        # (SUBACK) before we tear the connection down; closing earlier could
        # race the SUBACK and store a session without any subscription.
        helper = HelperPublisher()
        try:
            helper.publish_command(device_id, "warm-1")
        finally:
            helper.close()
        wait_until(
            lambda: any(c.get("messageId") == "warm-1" for c in first.drain_commands(50)),
            timeout=10,
            message="warm-up downlink was not received before shutdown",
        )
    finally:
        first.close()

    helper = HelperPublisher()
    try:
        helper.publish_command(device_id, "offline-1")
        helper.publish_command(device_id, "offline-2")
    finally:
        helper.close()

    second = Mqtt5Transport(device_id, broker_config())
    second.start()
    try:
        assert second.connected.wait(timeout=10), second.last_error
        commands = wait_for_commands(second, timeout=10)
        message_ids = {command.get("messageId") for command in commands}
        assert {"offline-1", "offline-2"} <= message_ids, f"missing offline messages, got {message_ids}"
    finally:
        second.close()


def test_suspend_resume_keeps_single_network_loop_and_receives_commands(plaintext_broker) -> None:
    device_id = device_name()
    transport = Mqtt5Transport(device_id, broker_config())
    transport.start()
    try:
        assert transport.connected.wait(timeout=10), transport.last_error
        for _ in range(5):
            transport.suspend()
            time.sleep(0.2)
            transport.resume()
            assert transport.connected.wait(timeout=10), transport.last_error or "resume did not reconnect"
        loops = paho_threads(f"paho-mqtt-client-{device_id}")
        assert len(loops) <= 1, f"expected at most one network loop, found {[t.name for t in loops]}"

        helper = HelperPublisher()
        try:
            helper.publish_command(device_id, "after-resume")
        finally:
            helper.close()
        commands = wait_for_commands(transport, timeout=10)
        assert any(command.get("messageId") == "after-resume" for command in commands)
    finally:
        transport.close()


def test_initial_connect_failure_recovers_when_broker_appears(plaintext_broker) -> None:
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    free_port = probe.getsockname()[1]
    probe.close()

    config = broker_config()
    config["port"] = free_port
    device_id = device_name()
    transport = Mqtt5Transport(device_id, config)
    transport.start()
    broker = subprocess.Popen(
        [MOSQUITTO_BIN, "-p", str(free_port)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        assert transport.connected.wait(timeout=20), transport.last_error or "transport never connected"
    finally:
        transport.close()
        broker.terminate()
        broker.wait(timeout=5)


def test_close_is_idempotent_and_stops_all_threads(plaintext_broker) -> None:
    device_id = device_name()
    transport = Mqtt5Transport(device_id, broker_config())
    transport.start()
    assert transport.connected.wait(timeout=10), transport.last_error

    transport.close()
    transport.close()

    wait_until(
        lambda: not paho_threads(f"paho-mqtt-client-{device_id}")
        and not paho_threads(f"mqtt-supervisor-{device_id}"),
        timeout=5,
        message="network or supervisor threads still alive after close",
    )
    time.sleep(0.5)
    assert not paho_threads(f"paho-mqtt-client-{device_id}"), "transport reconnected after close"

    with pytest.raises(MqttTransportError):
        transport.resume()
    with pytest.raises(MqttTransportError):
        transport.start()


def test_ack_generation_gate_rejects_stale_connection_mids() -> None:
    class FakeClient:
        def __init__(self) -> None:
            self.acks: list[tuple[int, int]] = []

        def ack(self, mid: int, qos: int) -> None:
            self.acks.append((mid, qos))

    transport = object.__new__(Mqtt5Transport)
    transport.device_id = "device-1"
    transport.commands = queue.Queue(maxsize=5)
    transport.client = FakeClient()
    transport.last_error = None
    transport._generation = 3

    stale = SimpleNamespace(qos=1, mid=9)
    assert transport._ack_if_current(stale, 2) is False
    assert transport.client.acks == []

    current = SimpleNamespace(qos=1, mid=10)
    assert transport._ack_if_current(current, 3) is True
    assert transport.client.acks == [(10, 1)]
