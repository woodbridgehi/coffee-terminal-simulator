from __future__ import annotations

import json
import queue
import socket
import ssl
import threading
from datetime import datetime, timezone
from typing import Any

import paho.mqtt.client as mqtt
import socks


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class MqttTransportError(RuntimeError):
    pass


class RoutedMqttClient(mqtt.Client):
    """Connect through a local TCP tunnel while preserving broker hostname for TLS SNI."""

    def __init__(self, *args: Any, connect_host: str | None = None, connect_port: int | None = None, **kwargs: Any) -> None:
        self._route_host = connect_host
        self._route_port = connect_port
        super().__init__(*args, **kwargs)

    def _create_socket_connection(self) -> Any:
        if not self._route_host:
            return super()._create_socket_connection()
        return socket.create_connection(
            (self._route_host, self._route_port or self._port), timeout=self._connect_timeout
        )


class Mqtt5Transport:
    """MQTT 5 transport only; business command/event semantics remain in the runtime."""

    def __init__(self, device_id: str, config: dict[str, Any]) -> None:
        self.device_id = device_id
        self.host = str(config.get("host") or "mqtt-api.woodbridge.top")
        self.port = int(config.get("port") or 8883)
        self.username = str(config.get("username") or device_id)
        self.password = str(config.get("password") or "")
        if not self.password:
            raise ValueError("MQTT password is required in mqtt5 transport mode")
        self.keepalive = int(config.get("keepaliveSeconds") or 30)
        self.session_expiry = int(config.get("sessionExpirySeconds") or 604800)
        self.connected = threading.Event()
        self.suspended = False
        self.commands: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=100)
        self.last_error: str | None = None
        self.client = RoutedMqttClient(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=device_id,
            protocol=mqtt.MQTTv5,
            connect_host=str(config.get("connectHost")) if config.get("connectHost") else None,
            connect_port=int(config.get("connectPort")) if config.get("connectPort") else None,
        )
        self.client.username_pw_set(self.username, self.password)
        if config.get("proxyHost"):
            proxy_types = {"http": socks.HTTP, "socks4": socks.SOCKS4, "socks5": socks.SOCKS5}
            proxy_name = str(config.get("proxyType") or "http").lower()
            if proxy_name not in proxy_types:
                raise ValueError(f"unsupported MQTT proxy type: {proxy_name}")
            self.client.proxy_set(
                proxy_type=proxy_types[proxy_name],
                proxy_addr=str(config["proxyHost"]),
                proxy_port=int(config.get("proxyPort") or 1080),
            )
        self.client.tls_set(cert_reqs=ssl.CERT_REQUIRED, tls_version=ssl.PROTOCOL_TLS_CLIENT)
        self.client.reconnect_delay_set(min_delay=1, max_delay=60)
        self.client.max_inflight_messages_set(20)
        self.client.manual_ack_set(True)
        self.client.will_set(
            self.topic("presence"),
            json.dumps({"deviceId": device_id, "online": False, "reason": "last_will", "sentAt": utc_now()}),
            qos=1,
            retain=True,
        )
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message

    def topic(self, suffix: str) -> str:
        return f"v1/devices/{self.device_id}/{suffix}"

    def start(self) -> None:
        properties = mqtt.Properties(mqtt.PacketTypes.CONNECT)
        properties.SessionExpiryInterval = self.session_expiry
        self.client.connect_async(
            self.host,
            self.port,
            keepalive=self.keepalive,
            clean_start=mqtt.MQTT_CLEAN_START_FIRST_ONLY,
            properties=properties,
        )
        self.client.loop_start()

    def close(self) -> None:
        if self.connected.is_set():
            try:
                self.publish_presence(False, "graceful_shutdown")
            except MqttTransportError:
                pass
        self.client.disconnect()
        self.client.loop_stop()
        self.connected.clear()

    def suspend(self) -> None:
        if self.suspended:
            return
        if self.connected.is_set():
            self.publish_presence(False, "simulated_offline")
        self.suspended = True
        self.client.disconnect()

    def resume(self) -> None:
        if not self.suspended:
            return
        self.suspended = False
        result = self.client.reconnect()
        if result != mqtt.MQTT_ERR_SUCCESS:
            raise MqttTransportError(mqtt.error_string(result))

    def _on_connect(self, client: mqtt.Client, _userdata: object, _flags: Any, reason: Any, _properties: Any) -> None:
        if reason.is_failure:
            self.last_error = f"CONNECT rejected: {reason}"
            self.connected.clear()
            return
        result, _ = client.subscribe(self.topic("down"), qos=1)
        if result != mqtt.MQTT_ERR_SUCCESS:
            self.last_error = f"subscribe failed: {mqtt.error_string(result)}"
            self.connected.clear()
            return
        self.last_error = None
        self.connected.set()
        self.publish_presence(True, "connected")

    def _on_disconnect(self, _client: mqtt.Client, _userdata: object, _flags: Any, reason: Any, _properties: Any) -> None:
        self.connected.clear()
        if reason.is_failure and not self.suspended:
            self.last_error = f"disconnected: {reason}"

    def _on_message(self, _client: mqtt.Client, _userdata: object, message: mqtt.MQTTMessage) -> None:
        try:
            value = json.loads(message.payload)
            command = value.get("payload") if value.get("type") == "command" else value
            if not isinstance(command, dict):
                raise ValueError("command payload must be an object")
            if command.get("deviceId") not in {None, self.device_id}:
                raise ValueError("command target does not match device")
            self.commands.put_nowait(command)
        except queue.Full:
            self.last_error = "command queue full; reconnecting for QoS1 redelivery"
            self.client.disconnect()
            return
        except (json.JSONDecodeError, ValueError) as exc:
            self.last_error = f"invalid downlink: {exc}"
        if message.qos:
            self.client.ack(message.mid, message.qos)

    def drain_commands(self, limit: int = 20) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        while len(result) < limit:
            try:
                result.append(self.commands.get_nowait())
            except queue.Empty:
                break
        return result

    def publish(self, kind: str, payload: dict[str, Any], *, qos: int = 1) -> None:
        if not self.connected.wait(timeout=8):
            raise MqttTransportError(self.last_error or "MQTT is not connected")
        envelope = {
            "schema": "coffee.mqtt-envelope.v1",
            "messageId": payload.get("eventId") or payload.get("messageId"),
            "deviceId": self.device_id,
            "type": kind,
            "sentAt": utc_now(),
            "payload": payload,
        }
        info = self.client.publish(self.topic("up"), json.dumps(envelope, ensure_ascii=False), qos=qos)
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            raise MqttTransportError(mqtt.error_string(info.rc))
        if qos:
            info.wait_for_publish(timeout=8)
            if not info.is_published():
                raise MqttTransportError("PUBACK timed out")

    def publish_presence(self, online: bool, reason: str) -> None:
        payload = {"deviceId": self.device_id, "online": online, "reason": reason, "sentAt": utc_now()}
        info = self.client.publish(self.topic("presence"), json.dumps(payload), qos=1, retain=True)
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            raise MqttTransportError(mqtt.error_string(info.rc))

    def publish_state(self, payload: dict[str, Any]) -> None:
        info = self.client.publish(self.topic("state"), json.dumps(payload, ensure_ascii=False), qos=1, retain=True)
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            raise MqttTransportError(mqtt.error_string(info.rc))
