"""Transactional local state for commands, jobs and cloud deliveries."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def canonical_json(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


class StateStoreError(RuntimeError):
    pass


class LocalStateStore:
    """One per terminal instance; safe for the runtime's worker threads."""

    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.lock = threading.RLock()
        self.connection = sqlite3.connect(path, timeout=10, check_same_thread=False, isolation_level=None)
        self.connection.row_factory = sqlite3.Row
        with self.lock:
            self.connection.execute("PRAGMA journal_mode=WAL")
            self.connection.execute("PRAGMA synchronous=FULL")
            self.connection.execute("PRAGMA foreign_keys=ON")
            check = self.connection.execute("PRAGMA quick_check").fetchone()[0]
            if check != "ok":
                raise StateStoreError(f"本地状态数据库完整性检查失败：{check}")
            schema_version = int(self.connection.execute("PRAGMA user_version").fetchone()[0])
            if schema_version > 1:
                raise StateStoreError(f"本地状态数据库版本过新：{schema_version}")
            self.connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS terminal_meta (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS command_inbox (
                    message_id TEXT PRIMARY KEY,
                    task_id TEXT,
                    command_type TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    payload_digest TEXT NOT NULL,
                    state TEXT NOT NULL,
                    result_json TEXT,
                    delivery_state TEXT NOT NULL DEFAULT 'NONE',
                    attempts INTEGER NOT NULL DEFAULT 0,
                    next_attempt_at REAL NOT NULL DEFAULT 0,
                    last_error TEXT,
                    received_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_command_delivery
                    ON command_inbox(delivery_state, next_attempt_at, received_at);
                CREATE INDEX IF NOT EXISTS idx_command_task
                    ON command_inbox(task_id, received_at);

                CREATE TABLE IF NOT EXISTS production_job (
                    task_id TEXT PRIMARY KEY,
                    state TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS event_outbox (
                    event_id TEXT PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    aggregate_id TEXT,
                    payload_json TEXT NOT NULL,
                    state TEXT NOT NULL DEFAULT 'PENDING',
                    attempts INTEGER NOT NULL DEFAULT 0,
                    next_attempt_at REAL NOT NULL DEFAULT 0,
                    last_error TEXT,
                    created_at TEXT NOT NULL,
                    sent_at TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_event_delivery
                    ON event_outbox(state, next_attempt_at, created_at);
                """
            )
            self.connection.execute("PRAGMA user_version=1")

    def close(self) -> None:
        with self.lock:
            self.connection.close()

    def get_meta(self, key: str, default: Any = None) -> Any:
        with self.lock:
            row = self.connection.execute("SELECT value_json FROM terminal_meta WHERE key = ?", (key,)).fetchone()
        return json.loads(row["value_json"]) if row else default

    def set_meta(self, key: str, value: Any) -> None:
        timestamp = now()
        with self.lock:
            self.connection.execute(
                """INSERT INTO terminal_meta(key, value_json, updated_at) VALUES (?, ?, ?)
                   ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at""",
                (key, canonical_json(value), timestamp),
            )

    def record_command(self, command: dict[str, Any]) -> tuple[str, dict[str, Any] | None]:
        raw_message_id = command.get("messageId")
        if not isinstance(raw_message_id, str) or not raw_message_id.strip():
            raise StateStoreError("命令缺少 messageId")
        message_id = raw_message_id.strip()
        payload_json = canonical_json(command)
        digest = hashlib.sha256(payload_json.encode("utf-8")).hexdigest()
        timestamp = now()
        with self.lock:
            self.connection.execute("BEGIN IMMEDIATE")
            try:
                existing = self.connection.execute(
                    "SELECT * FROM command_inbox WHERE message_id = ?", (message_id,)
                ).fetchone()
                if existing:
                    self.connection.execute("COMMIT")
                    record = self._command_record(existing)
                    return ("CONFLICT" if existing["payload_digest"] != digest else "EXISTING"), record
                self.connection.execute(
                    """INSERT INTO command_inbox(
                           message_id, task_id, command_type, payload_json, payload_digest,
                           state, received_at, updated_at
                       ) VALUES (?, ?, ?, ?, ?, 'RECEIVED', ?, ?)""",
                    (
                        message_id,
                        command.get("taskId"),
                        str(command.get("type") or "UNKNOWN"),
                        payload_json,
                        digest,
                        timestamp,
                        timestamp,
                    ),
                )
                self.connection.execute("COMMIT")
                return "NEW", None
            except Exception:
                self.connection.execute("ROLLBACK")
                raise

    def command(self, message_id: str) -> dict[str, Any] | None:
        with self.lock:
            row = self.connection.execute("SELECT * FROM command_inbox WHERE message_id = ?", (message_id,)).fetchone()
        return self._command_record(row) if row else None

    @staticmethod
    def _command_record(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "messageId": row["message_id"],
            "taskId": row["task_id"],
            "type": row["command_type"],
            "command": json.loads(row["payload_json"]),
            "state": row["state"],
            "result": json.loads(row["result_json"]) if row["result_json"] else None,
            "deliveryState": row["delivery_state"],
            "attempts": row["attempts"],
        }

    def complete_command(self, message_id: str, state: str, result: dict[str, Any], queue_delivery: bool) -> None:
        timestamp = now()
        with self.lock:
            self.connection.execute(
                """UPDATE command_inbox
                   SET state = ?, result_json = ?, delivery_state = ?, next_attempt_at = 0,
                       last_error = NULL, updated_at = ?
                   WHERE message_id = ?""",
                (state, canonical_json(result), "PENDING" if queue_delivery else "SENT", timestamp, message_id),
            )

    def pending_command_results(self, limit: int = 20) -> list[dict[str, Any]]:
        with self.lock:
            rows = self.connection.execute(
                """SELECT * FROM command_inbox
                   WHERE delivery_state = 'PENDING' AND next_attempt_at <= ?
                   ORDER BY received_at LIMIT ?""",
                (time.time(), limit),
            ).fetchall()
        return [self._command_record(row) for row in rows]

    def mark_command_result_sent(self, message_id: str) -> None:
        with self.lock:
            self.connection.execute(
                "UPDATE command_inbox SET delivery_state = 'SENT', last_error = NULL, updated_at = ? WHERE message_id = ?",
                (now(), message_id),
            )

    def mark_command_result_failed(self, message_id: str, error: str, retryable: bool, delay_seconds: float) -> None:
        with self.lock:
            self.connection.execute(
                """UPDATE command_inbox
                   SET delivery_state = ?, attempts = attempts + 1, next_attempt_at = ?,
                       last_error = ?, updated_at = ? WHERE message_id = ?""",
                ("PENDING" if retryable else "DEAD", time.time() + delay_seconds, error[:1000], now(), message_id),
            )

    def save_job(self, task: dict[str, Any], make_current: bool = True) -> int:
        task_id = str(task["taskId"])
        timestamp = now()
        with self.lock:
            self.connection.execute("BEGIN IMMEDIATE")
            try:
                row = self.connection.execute(
                    "SELECT revision, created_at FROM production_job WHERE task_id = ?", (task_id,)
                ).fetchone()
                revision = int(row["revision"]) + 1 if row else 1
                created_at = row["created_at"] if row else timestamp
                payload = dict(task)
                payload["revision"] = revision
                self.connection.execute(
                    """INSERT INTO production_job(task_id, state, revision, payload_json, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?)
                       ON CONFLICT(task_id) DO UPDATE SET state = excluded.state,
                           revision = excluded.revision, payload_json = excluded.payload_json,
                           updated_at = excluded.updated_at""",
                    (task_id, task["state"], revision, canonical_json(payload), created_at, timestamp),
                )
                if make_current:
                    self.connection.execute(
                        """INSERT INTO terminal_meta(key, value_json, updated_at) VALUES ('current_task_id', ?, ?)
                           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at""",
                        (canonical_json(task_id), timestamp),
                    )
                self.connection.execute("COMMIT")
                task["revision"] = revision
                return revision
            except Exception:
                self.connection.execute("ROLLBACK")
                raise

    def job(self, task_id: str) -> dict[str, Any] | None:
        with self.lock:
            row = self.connection.execute("SELECT payload_json FROM production_job WHERE task_id = ?", (task_id,)).fetchone()
        return json.loads(row["payload_json"]) if row else None

    def current_job(self) -> dict[str, Any] | None:
        task_id = self.get_meta("current_task_id")
        return self.job(task_id) if task_id else None

    def clear_current_job(self) -> None:
        with self.lock:
            self.connection.execute("DELETE FROM terminal_meta WHERE key = 'current_task_id'")

    def enqueue_event(self, event: dict[str, Any]) -> None:
        with self.lock:
            self.connection.execute(
                """INSERT OR IGNORE INTO event_outbox(
                       event_id, event_type, aggregate_id, payload_json, created_at
                   ) VALUES (?, ?, ?, ?, ?)""",
                (
                    event["eventId"],
                    event["type"],
                    event.get("payload", {}).get("taskId"),
                    canonical_json(event),
                    event["occurredAt"],
                ),
            )

    def pending_events(self, limit: int = 100) -> list[dict[str, Any]]:
        with self.lock:
            rows = self.connection.execute(
                """SELECT event_id, payload_json, attempts FROM event_outbox
                   WHERE state = 'PENDING' AND next_attempt_at <= ?
                   ORDER BY created_at LIMIT ?""",
                (time.time(), limit),
            ).fetchall()
        return [
            {"eventId": row["event_id"], "event": json.loads(row["payload_json"]), "attempts": row["attempts"]}
            for row in rows
        ]

    def mark_event_sent(self, event_id: str) -> None:
        with self.lock:
            self.connection.execute(
                "UPDATE event_outbox SET state = 'SENT', sent_at = ?, last_error = NULL WHERE event_id = ?",
                (now(), event_id),
            )

    def mark_event_failed(self, event_id: str, error: str, retryable: bool, delay_seconds: float) -> None:
        with self.lock:
            self.connection.execute(
                """UPDATE event_outbox
                   SET state = ?, attempts = attempts + 1, next_attempt_at = ?, last_error = ?
                   WHERE event_id = ?""",
                ("PENDING" if retryable else "DEAD", time.time() + delay_seconds, error[:1000], event_id),
            )

    def delivery_stats(self) -> dict[str, int]:
        with self.lock:
            event_rows = self.connection.execute(
                "SELECT state, COUNT(*) AS count FROM event_outbox GROUP BY state"
            ).fetchall()
            command_rows = self.connection.execute(
                "SELECT delivery_state AS state, COUNT(*) AS count FROM command_inbox GROUP BY delivery_state"
            ).fetchall()
        result = {f"events{row['state'].title()}": row["count"] for row in event_rows}
        result.update({f"commands{row['state'].title()}": row["count"] for row in command_rows})
        return result
