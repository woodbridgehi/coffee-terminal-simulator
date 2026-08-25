#!/usr/bin/env python3
from __future__ import annotations

import argparse, json, queue, socket, ssl, threading, uuid
from pathlib import Path
from typing import Any
import paho.mqtt.client as mqtt


def read_env(path: Path) -> dict[str, str]:
    return dict(line.split("=", 1) for line in path.read_text().splitlines() if line and not line.startswith("#") and "=" in line)


class Probe:
    def __init__(self, client_id: str, credentials: dict[str, str] | None, will: tuple[str, str, int, bool] | None = None) -> None:
        self.connected, self.subscribed = threading.Event(), threading.Event()
        self.subscribe_reasons: Any = None
        self.messages: queue.Queue[mqtt.MQTTMessage] = queue.Queue()
        self.reason: Any = None
        self.flags: Any = None
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id, protocol=mqtt.MQTTv5)
        if credentials:
            self.client.username_pw_set(credentials["MQTT_USERNAME"], credentials["MQTT_PASSWORD"])
        if will:
            self.client.will_set(*will)
        self.client.tls_set(cert_reqs=ssl.CERT_REQUIRED, tls_version=ssl.PROTOCOL_TLS_CLIENT)
        self.client.on_connect = self._on_connect
        self.client.on_subscribe = self._on_subscribe
        self.client.on_message = lambda _c, _u, message: self.messages.put(message)

    def _on_connect(self, _c: mqtt.Client, _u: object, flags: Any, reason: Any, _p: Any) -> None:
        self.flags, self.reason = flags, reason
        self.connected.set()

    def _on_subscribe(self, _c: mqtt.Client, _u: object, _mid: int, reasons: Any, _p: Any) -> None:
        self.subscribe_reasons = reasons
        self.subscribed.set()

    def connect(self, host: str, port: int, clean_start: bool | int = True, expiry: int = 0) -> None:
        props = mqtt.Properties(mqtt.PacketTypes.CONNECT)
        props.SessionExpiryInterval = expiry
        self.client.connect(host, port, keepalive=10, clean_start=clean_start, properties=props)
        self.client.loop_start()
        assert self.connected.wait(10), "MQTT CONNECT timeout"
        assert not self.reason.is_failure, f"CONNECT rejected: {self.reason}"

    def subscribe(self, topic: str, qos: int = 1) -> None:
        self.subscribed.clear(); self.client.subscribe(topic, qos=qos)
        assert self.subscribed.wait(8), f"SUBACK timeout: {topic}"
        assert not any(reason.is_failure for reason in self.subscribe_reasons), f"subscription rejected: {topic}"

    def subscribe_denied(self, topic: str) -> None:
        self.subscribed.clear(); self.client.subscribe(topic, qos=1)
        assert self.subscribed.wait(8), f"SUBACK timeout: {topic}"
        assert any(reason.is_failure for reason in self.subscribe_reasons), f"forbidden subscription allowed: {topic}"

    def receive(self, timeout: float = 8) -> mqtt.MQTTMessage:
        return self.messages.get(timeout=timeout)

    def close(self) -> None:
        self.client.disconnect(); self.client.loop_stop()


def wait_publish(info: mqtt.MQTTMessageInfo) -> None:
    info.wait_for_publish(timeout=8)
    assert info.is_published(), "publish not acknowledged"


def expect_rejected(host: str, port: int, credentials: dict[str, str] | None) -> None:
    probe = Probe(f"unauthorized-{uuid.uuid4().hex[:8]}", credentials)
    probe.client.connect(host, port, keepalive=5, clean_start=True)
    probe.client.loop_start()
    assert probe.connected.wait(8), "unauthorized CONNECT timeout"
    try:
        assert probe.reason.is_failure, "unauthorized client was accepted"
    finally:
        probe.client.loop_stop()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--device-env", type=Path, required=True)
    parser.add_argument("--gateway-env", type=Path, required=True)
    parser.add_argument("--connect-ip")
    args = parser.parse_args()
    device, gateway = read_env(args.device_env), read_env(args.gateway_env)
    host, port = device["MQTT_HOST"], int(device.get("MQTT_PORT", "8883"))
    if args.connect_ip:
        original = socket.getaddrinfo
        socket.getaddrinfo = lambda name, service, *a, **kw: original(args.connect_ip if name == host else name, service, *a, **kw)  # type: ignore[assignment]

    expect_rejected(host, port, None)
    wrong = {**device, "MQTT_PASSWORD": "definitely-wrong"}
    expect_rejected(host, port, wrong)
    print("PASS anonymous and invalid credentials rejected")

    suffix = uuid.uuid4().hex[:8]
    up, down = "v1/devices/coffee-bot-002/up", "v1/devices/coffee-bot-002/down"
    state, presence = "v1/devices/coffee-bot-002/state", "v1/devices/coffee-bot-002/presence"
    gw, dev = Probe(f"verify-gateway-{suffix}", gateway), Probe(f"verify-device-{suffix}", device)
    gw.connect(host, port); dev.connect(host, port); gw.subscribe(up)
    dev.subscribe_denied("v1/devices/coffee-bot-001/down")
    print("PASS per-device ACL isolation")
    for qos in (0, 1):
        payload = json.dumps({"test": f"qos{qos}", "id": suffix})
        info = dev.client.publish(up, payload, qos=qos)
        if qos == 1: wait_publish(info)
        received = gw.receive()
        assert received.payload.decode() == payload and received.qos == qos
    print("PASS MQTT 5.0 CONNECT and QoS 0/1 PUB/SUB")

    retained_payload = json.dumps({"status": "IDLE", "id": suffix})
    wait_publish(dev.client.publish(state, retained_payload, qos=1, retain=True))
    reader = Probe(f"verify-retain-{suffix}", gateway); reader.connect(host, port); reader.subscribe(state)
    retained = reader.receive(); assert retained.retain and retained.payload.decode() == retained_payload
    reader.close(); print("PASS retained state")

    session_id = f"verify-session-{suffix}"
    session = Probe(session_id, device); session.connect(host, port, mqtt.MQTT_CLEAN_START_FIRST_ONLY, 120); session.subscribe(down); session.close()
    offline_payload = json.dumps({"command": "offline-delivery", "id": suffix})
    wait_publish(gw.client.publish(down, offline_payload, qos=1))
    resumed = Probe(session_id, device); resumed.connect(host, port, False, 120)
    queued = resumed.receive(); assert resumed.flags.session_present and queued.payload.decode() == offline_payload
    resumed.close(); print("PASS persistent session and offline QoS 1 delivery")

    wait_publish(dev.client.publish(presence, "", qos=1, retain=True))
    gw.subscribe(presence)
    will_payload = json.dumps({"online": False, "reason": "last_will", "id": suffix})
    will_client = Probe(f"verify-will-{suffix}", device, (presence, will_payload, 1, True)); will_client.connect(host, port)
    sock = will_client.client._sock; assert sock is not None
    sock.shutdown(socket.SHUT_RDWR); sock.close()
    for _ in range(4):
        will_message = gw.receive(12)
        if will_message.payload.decode() == will_payload:
            break
    else:
        raise AssertionError("Last Will payload not observed")
    will_client.client.loop_stop(); print("PASS Last Will")

    wait_publish(dev.client.publish(state, "", qos=1, retain=True))
    gw.close(); dev.close()
    print("ALL MQTT 5.0 BROKER CHECKS PASSED")


if __name__ == "__main__":
    main()
