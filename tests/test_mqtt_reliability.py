from __future__ import annotations

import json
import queue
import sys
import tempfile
import threading
from pathlib import Path
from types import SimpleNamespace


PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "coffee-terminal"))

from mqtt_transport import Mqtt5Transport  # noqa: E402
from state_store import LocalStateStore  # noqa: E402


class FakeClient:
    def __init__(self) -> None:
        self.acks: list[tuple[int, int]] = []
        self.disconnects = 0

    def ack(self, mid: int, qos: int) -> None:
        self.acks.append((mid, qos))

    def disconnect(self) -> None:
        self.disconnects += 1


def transport_with_capacity(capacity: int = 1) -> Mqtt5Transport:
    transport = Mqtt5Transport("device-1", {"password": "test"})
    transport.commands = queue.Queue(maxsize=capacity)
    transport.client = FakeClient()
    transport.last_error = None
    transport._generation_lock = threading.Lock()
    transport._connection_valid = True
    return transport


def message(mid: int) -> SimpleNamespace:
    return SimpleNamespace(
        payload=json.dumps({"deviceId": "device-1", "messageId": f"message-{mid}", "type": "MAKE_DRINK"}),
        qos=1,
        mid=mid,
    )


def test_downlink_is_acked_only_after_it_enters_the_local_queue() -> None:
    transport = transport_with_capacity()
    transport._on_message(transport.client, None, message(1))
    assert transport.client.acks == [(1, 1)]

    transport._on_message(transport.client, None, message(2))
    assert transport.client.acks == [(1, 1)]
    assert transport.client.disconnects == 1


def test_pending_progress_is_coalesced_per_task() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        store = LocalStateStore(Path(temporary) / "runtime.db")
        try:
            for index, progress in enumerate((0.1, 0.2), start=1):
                store.enqueue_event({
                    "eventId": f"event-{index}", "type": "task.progress",
                    "occurredAt": f"2026-08-30T00:00:0{index}Z",
                    "payload": {"taskId": "task-1", "overallProgress": progress},
                })
            pending = store.pending_events()
            assert len(pending) == 1
            assert pending[0]["event"]["payload"]["overallProgress"] == 0.2
        finally:
            store.close()
