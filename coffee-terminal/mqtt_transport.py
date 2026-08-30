from __future__ import annotations

import json
import logging
import queue
import socket
import ssl
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable

import paho.mqtt.client as mqtt
import socks

log = logging.getLogger("coffee-terminal.mqtt")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class MqttTransportError(RuntimeError):
    pass


class RoutedMqttClient(mqtt.Client):
    """Connect through a local TCP tunnel while preserving broker hostname for TLS SNI."""

    before_reconnect: Callable[[], None] | None = None

    def reconnect(self) -> mqtt.MQTTErrorCode:
        # Paho's on_pre_connect runs AFTER clearing outbound packets. Fence
        # before super(), including automatic reconnects, so old ACKs cannot
        # be appended after that clear and then sent on the new socket.
        if self.before_reconnect is not None:
            self.before_reconnect()
        return super().reconnect()

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
    """MQTT 5 transport only; business command/event semantics remain in the runtime.

    Connection lifecycle contract (B1.1):

    - The MQTT client id equals the device id and the session is persistent
      (``clean_start=False`` with a non-zero session expiry), so an offline
      QoS1 downlink queued by the broker is redelivered after any restart.
    - Exactly one supervisor thread owns reconnection. Paho's network loop
      terminates after an explicit ``disconnect()`` (suspend, backpressure),
      and only the supervisor performs ``loop_stop -> reconnect -> loop_start``.
      Network callbacks only record state; they never join or reconnect.
    - ``close()`` is idempotent and terminal: after it, ``start()``/``resume()``
      raise and no thread is left behind.
    - Every received message belongs to a connection generation; an ACK is
      only valid on the same generation that delivered the message.
    """

    # Connection generation of the current connection. Class-level defaults
    # keep partially constructed instances (tests) valid.
    _generation: int = 0
    _connection_valid: bool = False

    SUPERVISOR_INTERVAL_SECONDS = 0.3
    RECONNECT_BACKOFF_MAX_SECONDS = 60.0
    SUBSCRIBE_TIMEOUT_SECONDS = 10.0

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
        self.session_present: bool | None = None
        self.commands: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=100)
        self.last_error: str | None = None
        self._closed = False
        self._started = False
        self._lifecycle_lock = threading.Lock()
        self._reconnect_lock = threading.Lock()
        # ACK may synchronously reenter on_disconnect on a socket write error.
        # Never hold this lock over loop_stop/join or blocking reconnect I/O.
        self._generation_lock = threading.RLock()
        self._pending_subscribe_mid: int | None = None
        self._subscribe_deadline = 0.0
        self._supervisor_stop = threading.Event()
        self._supervisor: threading.Thread | None = None
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
        self.client.on_subscribe = self._on_subscribe
        self.client.before_reconnect = self._invalidate_connection

    def topic(self, suffix: str) -> str:
        return f"v1/devices/{self.device_id}/{suffix}"

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def start(self) -> None:
        if self._closed:
            raise MqttTransportError("transport is closed")
        with self._lifecycle_lock:
            if self._started:
                return
            self._started = True
        properties = mqtt.Properties(mqtt.PacketTypes.CONNECT)
        properties.SessionExpiryInterval = self.session_expiry
        self.client.connect_async(
            self.host,
            self.port,
            keepalive=self.keepalive,
            clean_start=False,
            properties=properties,
        )
        self.client.loop_start()
        self._supervisor = threading.Thread(
            target=self._supervise, name=f"mqtt-supervisor-{self.device_id}", daemon=True
        )
        self._supervisor.start()

    def close(self) -> None:
        with self._lifecycle_lock:
            if self._closed:
                return
            self._closed = True
        self._supervisor_stop.set()
        if self.connected.is_set():
            try:
                self.publish_presence(False, "graceful_shutdown")
            except MqttTransportError:
                pass
        self._invalidate_connection()
        # Take the reconnect lock so a supervisor reconnect in flight either
        # observes the closed flag and tears its fresh connection down, or we
        # tear it down here; close returns with no new connection or loop left.
        with self._reconnect_lock:
            try:
                self._disconnect()
            except Exception:  # pragma: no cover - paho defensive
                pass
            try:
                self.client.loop_stop()
            except Exception:  # pragma: no cover - paho defensive
                pass
        self._invalidate_connection()
        supervisor = self._supervisor
        if supervisor is not None and supervisor is not threading.current_thread():
            supervisor.join(timeout=5)

    def suspend(self) -> None:
        if self._closed or self.suspended:
            return
        self.suspended = True
        if self.connected.is_set():
            try:
                self.publish_presence(False, "simulated_offline")
            except MqttTransportError:
                pass
        try:
            self._disconnect()
        except Exception:  # pragma: no cover - paho defensive
            pass
        # The network loop terminates on its own; the supervisor stays idle
        # while suspended and never reconnects from a network callback.

    def resume(self) -> None:
        if self._closed:
            raise MqttTransportError("transport is closed")
        if not self.suspended:
            return
        self.suspended = False
        # The supervisor picks the reconnect up within one poll interval.

    # ------------------------------------------------------------------
    # Connection supervision
    # ------------------------------------------------------------------
    def _loop_thread(self) -> threading.Thread | None:
        thread = getattr(self.client, "_thread", None)
        return thread if thread is not None and thread.is_alive() else None

    def _supervise(self) -> None:
        failures = 0
        next_retry_at = 0.0
        while not self._supervisor_stop.wait(self.SUPERVISOR_INTERVAL_SECONDS):
            if self._closed or self.suspended:
                failures = 0
                next_retry_at = 0.0
                continue
            self._check_subscription_timeout()
            if self._loop_thread() is not None:
                # The network loop is alive: healthy, or retrying on its own
                # (initial connect / transient failures). A live loop is the
                # source of truth; a stale `connected` flag from a crashed
                # loop must never mask recovery.
                if self.connected.is_set():
                    failures = 0
                    next_retry_at = 0.0
                continue
            if time.monotonic() < next_retry_at:
                continue
            self._recover_once()
            failures += 1
            next_retry_at = time.monotonic() + min(
                self.RECONNECT_BACKOFF_MAX_SECONDS, 1.0 * (2 ** min(failures - 1, 6))
            )

    def _recover_once(self) -> None:
        """Restore the network loop after it died. Runs on the supervisor
        thread only; rechecks close/suspend after reconnect() so a close
        racing the reconnect never leaves a fresh connection or loop."""
        with self._reconnect_lock:
            if self._closed or self.suspended or self._supervisor_stop.is_set():
                return
            self._invalidate_connection()
            log.warning(
                "MQTT network loop is dead; supervisor restoring connection device=%s", self.device_id
            )
            try:
                # Make sure a previous loop thread is fully stopped before
                # starting a new one; this never runs on the network thread.
                self.client.loop_stop()
            except Exception:  # pragma: no cover - paho defensive
                pass
            result = mqtt.MQTT_ERR_CONN_REFUSED
            try:
                result = self.client.reconnect()
            except (OSError, ValueError) as exc:
                self.last_error = f"reconnect failed: {exc}"
            if self._closed or self.suspended or self._supervisor_stop.is_set():
                log.warning("close raced the reconnect; discarding restored connection")
                try:
                    self._disconnect()
                except Exception:  # pragma: no cover - paho defensive
                    pass
                return
            if result == mqtt.MQTT_ERR_SUCCESS:
                self.client.loop_start()
            else:
                self.last_error = self.last_error or mqtt.error_string(result)

    # ------------------------------------------------------------------
    # Network callbacks (signal only; never join or reconnect inline)
    # ------------------------------------------------------------------
    def _on_connect(self, client: mqtt.Client, _userdata: object, flags: Any, reason: Any, _properties: Any) -> None:
        self._invalidate_connection()
        if self._closed or self.suspended:
            self._disconnect()
            return
        if reason.is_failure:
            self.last_error = f"CONNECT rejected: {reason}"
            self.connected.clear()
            return
        self.session_present = bool(getattr(flags, "session_present", False))
        if not self.session_present:
            log.warning(
                "MQTT session not present for device=%s; broker may have dropped queued QoS1 downlink",
                self.device_id,
            )
        with self._generation_lock:
            self._generation += 1
            self._connection_valid = True
            self._subscribe_deadline = time.monotonic() + self.SUBSCRIBE_TIMEOUT_SECONDS
        result, mid = client.subscribe(self.topic("down"), qos=1)
        if result != mqtt.MQTT_ERR_SUCCESS:
            self.last_error = f"subscribe failed: {mqtt.error_string(result)}"
            self.connected.clear()
            self._disconnect()
            return
        with self._generation_lock:
            self._pending_subscribe_mid = mid

    def _on_subscribe(self, _client: mqtt.Client, _userdata: object, mid: int, reasons: Any, _properties: Any) -> None:
        with self._generation_lock:
            if not self._connection_valid or mid != self._pending_subscribe_mid or self._closed or self.suspended:
                return
            failed = len(reasons) != 1 or any(reason.is_failure or reason.value != 1 for reason in reasons)
            if not failed:
                self._pending_subscribe_mid = None
                self._subscribe_deadline = 0.0
                self.last_error = None
                self.connected.set()
        if failed:
            self.last_error = f"required QoS1 subscription rejected/downgraded: {reasons}"
            self._disconnect()
            return
        try:
            self.publish_presence(True, "connected")
        except MqttTransportError as exc:
            self.last_error = f"presence publish failed: {exc}"

    def _invalidate_connection(self) -> None:
        with self._generation_lock:
            self._connection_valid = False
            self.connected.clear()
            self._pending_subscribe_mid = None
            self._subscribe_deadline = 0.0

    def _disconnect(self) -> None:
        self._invalidate_connection()
        self.client.disconnect()

    def _check_subscription_timeout(self) -> None:
        with self._generation_lock:
            expired = self._subscribe_deadline and time.monotonic() >= self._subscribe_deadline
        if expired:
            self.last_error = "MQTT SUBACK timed out; reconnecting"
            self._disconnect()

    def _on_disconnect(self, _client: mqtt.Client, _userdata: object, _flags: Any, reason: Any, _properties: Any) -> None:
        self._invalidate_connection()
        if reason.is_failure and not self.suspended:
            self.last_error = f"disconnected: {reason}"

    def _on_message(self, _client: mqtt.Client, _userdata: object, message: mqtt.MQTTMessage) -> None:
        generation = self._generation
        try:
            value = json.loads(message.payload)
            if not isinstance(value, dict):
                raise ValueError("downlink payload must be an object")
            command = value.get("payload") if value.get("type") == "command" else value
            if not isinstance(command, dict):
                raise ValueError("command payload must be an object")
            if command.get("deviceId") not in {None, self.device_id}:
                raise ValueError("command target does not match device")
            self.commands.put_nowait(command)
        except queue.Full:
            self.last_error = "command queue full; reconnecting for QoS1 redelivery"
            self._disconnect()
            return
        except (ValueError, UnicodeError) as exc:
            self.last_error = f"invalid downlink: {exc}"
        except Exception as exc:
            # Local execution/allocation failures are NOT permanent bad input.
            # Leave unacknowledged and request broker redelivery.
            self.last_error = f"downlink processing failed: {exc}"
            log.exception("downlink processing failed")
            self._disconnect()
            return
        self._ack_if_current(message, generation)

    def _ack_if_current(self, message: mqtt.MQTTMessage, generation: int) -> bool:
        """ACK only when the message belongs to the current, still-valid
        connection generation. The validity check and the ACK send are
        serialised with connection switches: a disconnect invalidates the
        generation immediately, so a matching number alone never authorises
        an ACK, and a concurrent reconnect cannot slip between check and
        send. A refused ACK is safe: the persistent session redelivers."""
        with self._generation_lock:
            if not self._connection_valid or generation != self._generation:
                return False
            if message.qos:
                self.client.ack(message.mid, message.qos)
            return True

    # ------------------------------------------------------------------
    # Publishing
    # ------------------------------------------------------------------
    def drain_commands(self, limit: int = 20) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        while len(result) < limit:
            try:
                result.append(self.commands.get_nowait())
            except queue.Empty:
                break
        return result

    def publish(self, kind: str, payload: dict[str, Any], *, qos: int = 1) -> None:
        if self._closed:
            raise MqttTransportError("transport is closed")
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
