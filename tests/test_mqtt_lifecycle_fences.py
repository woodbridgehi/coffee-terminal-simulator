"""Paho socket/lifecycle regressions; no external Broker is needed."""

import socket
import sys
import threading
from pathlib import Path
from types import SimpleNamespace

import paho.mqtt.client as mqtt
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "coffee-terminal"))
from mqtt_transport import Mqtt5Transport  # noqa: E402


@pytest.fixture
def transport(monkeypatch):
    monkeypatch.setattr(mqtt.Client, "tls_set", lambda *a, **k: None)
    return Mqtt5Transport("fence-test", {"password": "test"})


def test_ack_write_failure_does_not_deadlock(transport):
    left, right = socket.socketpair()
    transport.client._sock = left
    transport._generation = 5
    transport._connection_valid = True

    def fail_send(data):
        raise OSError("injected write failure")

    transport.client._sock_send = fail_send
    worker = threading.Thread(
        target=lambda: transport._ack_if_current(SimpleNamespace(mid=42, qos=1), 5),
        daemon=True,
    )
    try:
        worker.start()
        worker.join(1)
        assert not worker.is_alive()
        assert not transport._connection_valid
    finally:
        left.close()
        right.close()


@pytest.mark.parametrize("supervised", [False, True])
def test_reconnect_invalidates_old_acks_before_socket_creation(
    transport, monkeypatch, supervised
):
    client = transport.client
    client.connect_async("127.0.0.1", 1883, clean_start=False)
    transport._generation = 5
    transport._connection_valid = True
    transport.connected.set()
    left, right = socket.socketpair()
    right.settimeout(1)
    observed = []

    def create_socket():
        observed.append(transport._connection_valid)
        return left

    monkeypatch.setattr(client, "_create_socket", create_socket)
    monkeypatch.setattr(client, "loop_start", lambda: None)
    try:
        if supervised:
            transport._recover_once()
        else:
            client.reconnect()
        transport._ack_if_current(SimpleNamespace(mid=42, qos=1), 5)
        wire = right.recv(4096)
        assert observed == [False]
        assert b"\x40\x02\x00\x2a" not in wire
        assert not transport.connected.is_set()
    finally:
        client.disconnect()
        left.close()
        right.close()


def test_subscription_denial_cannot_report_device_online(transport, monkeypatch):
    monkeypatch.setattr(transport.client, "subscribe", lambda *a, **k: (0, 1))
    monkeypatch.setattr(transport.client, "disconnect", lambda: None)
    presence = []
    monkeypatch.setattr(transport, "publish_presence", lambda *a: presence.append(a))
    transport._on_connect(
        transport.client,
        None,
        SimpleNamespace(session_present=True),
        SimpleNamespace(is_failure=False),
        None,
    )
    assert not transport.connected.is_set()
    transport._on_subscribe(
        transport.client,
        None,
        1,
        [mqtt.ReasonCode(mqtt.PacketTypes.SUBACK, identifier=128)],
        None,
    )
    assert not transport.connected.is_set()
    assert not presence


def test_unexpected_queue_failure_is_not_acked_as_bad_payload(transport, monkeypatch):
    transport._connection_valid = True
    acks, disconnects = [], []
    monkeypatch.setattr(transport.client, "ack", lambda *a: acks.append(a))
    monkeypatch.setattr(
        transport.client, "disconnect", lambda: disconnects.append(True)
    )

    def fail_put(command):
        raise MemoryError("injected allocation failure")

    monkeypatch.setattr(transport.commands, "put_nowait", fail_put)
    transport._on_message(
        transport.client,
        None,
        SimpleNamespace(payload=b'{"messageId":"42"}', mid=42, qos=1),
    )
    assert not acks
    assert disconnects


def test_reconnect_fences_before_paho_packet_reset(transport, monkeypatch):
    transport._connection_valid = True
    observed = []

    def reconnect(client):
        observed.append(transport._connection_valid)
        return 0

    monkeypatch.setattr(mqtt.Client, "reconnect", reconnect)
    transport.client.reconnect()
    assert observed == [False]


def test_subscriptions_reset_and_presence_waits_for_success(transport, monkeypatch):
    mids = iter([1, 2])
    presence = []
    monkeypatch.setattr(transport.client, "subscribe", lambda *a, **k: (0, next(mids)))
    monkeypatch.setattr(transport, "publish_presence", lambda *a: presence.append(a))

    def connect():
        transport._on_connect(
            transport.client,
            None,
            SimpleNamespace(session_present=True),
            SimpleNamespace(is_failure=False),
            None,
        )

    success = [mqtt.ReasonCode(mqtt.PacketTypes.SUBACK, identifier=1)]
    connect()
    transport._on_disconnect(
        transport.client, None, None, SimpleNamespace(is_failure=False), None
    )
    connect()
    transport._on_subscribe(transport.client, None, 1, success, None)
    assert not transport.connected.is_set()
    assert not presence
    transport._on_subscribe(transport.client, None, 2, success, None)
    assert transport.connected.is_set()
    assert presence == [(True, "connected")]


def test_subscription_timeout_revokes_connection(transport, monkeypatch):
    disconnects = []
    monkeypatch.setattr(
        transport.client, "disconnect", lambda: disconnects.append(True)
    )
    transport._connection_valid = True
    transport._pending_subscribe_mid = 1
    transport._subscribe_deadline = 1.0
    transport._check_subscription_timeout()
    assert not transport._connection_valid
    assert transport._pending_subscribe_mid is None
    assert disconnects == [True]
