"""Local device runtime with optional real cloud connectivity."""
from __future__ import annotations

import json
import random
import threading
import time
import uuid
from base64 import b64encode
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

import qrcode

from catalog import RecipeCatalog
from cloud import CloudClient, CloudError
from configuration import write_config
from failures import FailurePolicy
from inventory import InventoryError, InventoryManager
from local_api import DeviceApiServer
from locales import normalize_locale
from mqtt_transport import Mqtt5Transport, MqttTransportError
from state_store import LocalStateStore, StateStoreError


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


ACTIVE_STATES = {"RECEIVED", "VALIDATING", "ACKNOWLEDGED", "RUNNING", "PAUSED", "RETRY_WAIT"}
SUPPORTED_TRANSPORTS = {"http", "mqtt5"}


class CoffeeDeviceRuntime:
    def __init__(self, config: dict[str, Any], instance_dir: Path) -> None:
        self.config = config
        self.instance_dir = instance_dir
        self.device_id = config["deviceId"]
        self.mode = config.get("backend", {}).get("mode", "remote")
        self.transport_name = "local" if self.mode == "local" else str(config.get("backend", {}).get("transport", "http")).strip().lower()
        if self.mode != "local" and self.transport_name not in SUPPORTED_TRANSPORTS:
            raise ValueError(f"unsupported remote transport: {self.transport_name}")
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.boot_id = str(uuid.uuid4())
        self.sequence = 0
        self.events: list[dict[str, Any]] = []
        self.store = LocalStateStore(instance_dir / "state" / "runtime.db")
        self.store.prune_deliveries()
        recovered_task = self.store.current_job()
        recovery_hold = bool(self.mode == "remote" and recovered_task and recovered_task.get("state") in ACTIVE_STATES)
        if recovery_hold:
            previous_state = recovered_task.get("state")
            recovered_task.update({"state": "PAUSED", "message": "重启恢复后等待后台对账，禁止直接继续制作", "recoveryPreviousState": previous_state, "recoveryHold": True})
            self.store.save_job(recovered_task)
        self.command_cursor: str | None = self.store.get_meta("command_cursor")
        self.last_synced_capability: tuple[str, int] | None = None
        self.last_synced_inventory = -1
        self._last_mqtt_state_fingerprint: tuple[Any, ...] | None = None
        self._mqtt_state_revision = 0
        progress_report = config.get("backend", {}).get("progressReport", {})
        self.progress_min_delta = max(0.01, min(1.0, float(progress_report.get("minDeltaPercent", 5)) / 100))
        self.progress_max_interval = max(1.0, float(progress_report.get("maxIntervalSeconds", 5)))
        self._progress_reports: dict[str, tuple[float, float]] = {}
        self.sync_health: dict[str, Any] = {"threadAlive": False, "lastSuccessAt": None, "lastError": None}

        recoverable = bool(recovered_task and recovered_task.get("state") in ACTIVE_STATES)
        self.inventory = InventoryManager(
            instance_dir / "materials.json",
            instance_dir / "state" / "inventory.json",
            clear_reservations=not recoverable,
        )
        self.material_statuses = {item["materialId"]: item["status"] for item in self.inventory.snapshot()["materials"]}
        self.catalog = RecipeCatalog(instance_dir / "recipes", self.inventory)
        self.failures = FailurePolicy(instance_dir / "failures.json")
        backend_url = config.get("backend", {}).get("baseUrl", "http://localhost:8080").rstrip("/")
        self.runtime: dict[str, Any] = {
            "deviceStatus": "RECOVERING" if recovery_hold else self._device_status_for_task(recovered_task),
            "connection": "CONNECTING" if self.mode == "remote" else "ONLINE",
            "qrUrl": f"{backend_url}/order?device_id={self.device_id}",
            "qrExpiresAt": None,
            "task": recovered_task,
            "override": {"globalFailureRate": 0.0, "forceFailNext": False, "offline": False, "eventDelayMs": 0},
            "events": self.events,
        }
        self.cloud = CloudClient(config) if self.mode == "remote" else None
        self.mqtt = Mqtt5Transport(self.device_id, config["backend"].get("mqtt", {})) if self.cloud and self.transport_name == "mqtt5" else None
        self.local_api: DeviceApiServer | None = None
        local_api = config.get("localApi", {})
        if local_api.get("enabled", True):
            self.local_api = DeviceApiServer(
                self,
                local_api.get("host", "127.0.0.1"),
                int(local_api.get("port", 9101)),
                settings=local_api,
                environment=str(config.get("environment", "development")),
            )
            self.local_api.start()
        self._emit("device.online", "设备运行时已启动", queue=False)
        if recovered_task:
            self._emit(
                "task.recovered",
                "已从本地事务状态恢复任务",
                {**self._task_ref(recovered_task), "state": recovered_task.get("state"), "revision": recovered_task.get("revision")},
            )
        self.background_threads = [threading.Thread(target=self._execution_loop, daemon=True)]
        self.background_threads[0].start()
        if self.cloud:
            cloud_thread = threading.Thread(target=self._cloud_loop, daemon=True)
            self.background_threads.append(cloud_thread)
            cloud_thread.start()

    def _emit(self, event_type: str, message: str, payload: dict[str, Any] | None = None, queue: bool = True) -> dict[str, Any]:
        with self.lock:
            self.sequence += 1
            event = {"schema": "coffee.device-event.v1", "eventId": str(uuid.uuid4()), "deviceId": self.device_id, "bootId": self.boot_id, "sequence": self.sequence, "occurredAt": now(), "type": event_type, "message": message, "payload": payload or {}}
            self.events.insert(0, event)
            del self.events[50:]
            if queue and self.cloud:
                self.store.enqueue_event(event)
            return event

    def close(self) -> None:
        """Stop background work and release the per-instance local API port."""
        self.stop_event.set()
        if self.mqtt:
            self.mqtt.close()
        if self.local_api:
            self.local_api.stop()
        for thread in self.background_threads:
            thread.join(timeout=self.cloud.timeout + 1 if self.cloud else 2)
        self.store.close()

    @staticmethod
    def _device_status_for_task(task: dict[str, Any] | None) -> str:
        if not task:
            return "IDLE"
        return {
            "ACKNOWLEDGED": "RESERVED",
            "RUNNING": "BUSY",
            "PAUSED": "BUSY",
            "RETRY_WAIT": "BUSY",
            "FAILED": "FAILED",
            "SUCCEEDED": "READY",
            "CANCELLED": "IDLE",
        }.get(str(task.get("state")), "RECOVERING")

    _qr_cache: dict[str, str] = {}

    @classmethod
    def _qr_data_url(cls, value: str) -> str:
        if not value:
            return ""
        cached = cls._qr_cache.get(value)
        if cached:
            return cached
        image = qrcode.make(value, border=2)
        buffer = BytesIO(); image.save(buffer, format="PNG")
        encoded = "data:image/png;base64," + b64encode(buffer.getvalue()).decode("ascii")
        if len(cls._qr_cache) > 50:
            cls._qr_cache.clear()
        cls._qr_cache[value] = encoded
        return encoded

    # pywebview and local API reads
    def get_state(self) -> dict[str, Any]:
        with self.lock:
            runtime = dict(self.runtime)
            runtime["events"] = list(self.events)
            runtime["qrDataUrl"] = self._qr_data_url(runtime.get("qrUrl", ""))
            runtime["inventory"] = self.inventory.snapshot()
            public_config = json.loads(json.dumps(self.config))
            public_backend = public_config.get("backend", {})
            public_backend["authConfigured"] = bool(public_backend.pop("authToken", None))
            header_names = sorted(public_backend.get("headers", {}).keys())
            public_backend.pop("headers", None)
            if header_names:
                public_backend["headerNames"] = header_names
            return {"config": public_config, "recipes": self.catalog.list(), "capabilities": self.capabilities(), "runtime": runtime, "backend": {"mode": self.mode, "transport": self.transport_name, "baseUrl": self.config.get("backend", {}).get("baseUrl")}}

    def health(self) -> dict[str, Any]:
        return {"ok": True, "deviceId": self.device_id, "bootId": self.boot_id, "transport": self.transport_name, "connection": self.runtime["connection"], "deviceStatus": self.runtime["deviceStatus"], "sync": dict(self.sync_health), "deliveries": self.store.delivery_stats(), "time": now()}

    def capabilities(self) -> dict[str, Any]:
        result = self.catalog.capabilities(self.device_id, self.config.get("storeId", ""))
        result["generatedAt"] = now()
        return result

    def inventory_snapshot(self) -> dict[str, Any]:
        return {"deviceId": self.device_id, **self.inventory.snapshot()}

    def status(self) -> dict[str, Any]:
        return {"deviceId": self.device_id, "instanceId": self.config["instanceId"], "storeId": self.config.get("storeId"), "transport": self.transport_name, "connection": self.runtime["connection"], "deviceStatus": self.runtime["deviceStatus"], "currentTask": self.runtime["task"], "capabilityVersion": self.catalog.version, "inventoryVersion": self.inventory.state["version"], "sync": dict(self.sync_health), "deliveries": self.store.delivery_stats()}

    # Configuration and operator actions
    def set_ui_locale(self, locale: str) -> dict[str, Any]:
        normalized = normalize_locale(locale)
        with self.lock:
            persisted = {key: value for key, value in self.config.items() if key != "_configPath"}
            persisted.setdefault("ui", {})["locale"] = normalized
            config_path = Path(str(self.config.get("_configPath") or self.instance_dir / "device.json"))
            write_config(config_path, persisted)
            self.config.setdefault("ui", {})["locale"] = normalized
        return {"ok": True, "locale": normalized}

    def reload_config(self) -> dict[str, Any]:
        with self.lock:
            task = self.runtime.get("task")
            if task and task.get("state") in ACTIVE_STATES:
                return {"ok": False, "error": "制作任务执行期间不能刷新配置"}
            try:
                self.inventory.reload(); self.catalog.reload(); self.failures.reload()
                self.last_synced_capability = None; self.last_synced_inventory = -1
                self._emit("capability.changed", "本地配置已刷新", {"capabilityVersion": self.catalog.version})
                return {"ok": True, "capabilities": self.capabilities(), "inventory": self.inventory_snapshot()}
            except (OSError, ValueError, json.JSONDecodeError) as exc:
                return {"ok": False, "error": str(exc)}

    def save_recipe(self, raw_json: str) -> dict[str, Any]:
        try:
            with self.lock:
                task = self.runtime.get("task")
                if task and task.get("state") in ACTIVE_STATES:
                    return {"ok": False, "error": "制作任务执行期间不能修改配方"}
            recipe = json.loads(raw_json)
            safe_name = "".join(char for char in recipe["recipeId"] if char.isalnum() or char in "-_")
            if not safe_name:
                raise ValueError("无效 recipeId")
            (self.instance_dir / "recipes" / f"{safe_name}.json").write_text(json.dumps(recipe, ensure_ascii=False, indent=2), encoding="utf-8")
            return self.reload_config()
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            return {"ok": False, "error": str(exc)}

    def adjust_inventory(self, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            change = self.inventory.adjust(payload["materialId"], payload.get("mode", "ADD"), float(payload["amount"]))
            change.update({"reason": payload.get("reason", "OPERATOR_ADJUSTMENT"), "operatorId": payload.get("operatorId")})
            self._emit("inventory.adjusted", f"物料 {change['materialId']} 已调整", change)
            self._inventory_changed()
            return {"ok": True, "change": change, "inventory": self.inventory_snapshot()}
        except (InventoryError, KeyError, TypeError, ValueError) as exc:
            return {"ok": False, "error": str(exc)}

    def update_override(self, payload: dict[str, Any]) -> dict[str, Any]:
        rate = float(payload.get("globalFailureRate", self.failures.runtime_failure_rate))
        if not 0 <= rate <= 1:
            return {"ok": False, "error": "globalFailureRate 必须在 0 到 1 之间"}
        self.failures.runtime_failure_rate = rate
        self.runtime["override"]["globalFailureRate"] = rate
        self.runtime["override"]["eventDelayMs"] = int(payload.get("eventDelayMs", self.runtime["override"].get("eventDelayMs", 0)))
        self._emit("debug.config-updated", "运行时故障配置已更新", dict(self.runtime["override"]))
        if self.cloud:
            try:
                self.cloud.debug_overrides(payload)
            except CloudError:
                pass
        return {"ok": True}

    # Task intake
    def start_demo_order(self, recipe_id: str) -> dict[str, Any]:
        if self.cloud:
            try:
                return {"ok": True, **self.cloud.debug_order(recipe_id, now())}
            except CloudError as exc:
                return {"ok": False, "error": f"后台调试下单失败：{exc}"}
        demo_order_no = f"C{datetime.now().strftime('%m%d')}-{uuid.uuid4().hex[:6].upper()}"
        return self._accept_task({"messageId": f"local-{uuid.uuid4()}", "type": "MAKE_DRINK", "taskId": f"task-{uuid.uuid4().hex[:10]}", "orderId": f"order-{uuid.uuid4().hex[:6]}", "orderNo": demo_order_no, "recipeId": recipe_id})

    def _accept_task(self, command: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            if not isinstance(command.get("taskId"), str) or not command["taskId"].strip() or not isinstance(command.get("recipeId"), str) or not command["recipeId"].strip():
                return self._reject(command, "INVALID_COMMAND", {"required": ["taskId", "recipeId"]})
            if command.get("expiresAt"):
                try:
                    expires_at = datetime.fromisoformat(command["expiresAt"].replace("Z", "+00:00"))
                    if expires_at <= datetime.now(timezone.utc):
                        return self._reject(command, "COMMAND_EXPIRED", {"expiresAt": command["expiresAt"]})
                except (TypeError, ValueError):
                    return self._reject(command, "INVALID_COMMAND", {"field": "expiresAt"})
            previous = self.store.job(str(command["taskId"]))
            if previous:
                previous_recipe_id = previous.get("recipe", {}).get("recipeId")
                order_conflict = bool(previous.get("orderId") and command.get("orderId") and previous.get("orderId") != command.get("orderId"))
                if previous_recipe_id != command.get("recipeId") or order_conflict:
                    return self._reject(command, "TASK_ID_CONFLICT", {"previousRecipeId": previous_recipe_id, "requestedRecipeId": command.get("recipeId"), "previousOrderId": previous.get("orderId"), "requestedOrderId": command.get("orderId")})
                accepted = previous.get("state") not in {"REJECTED", "CANCELLED"}
                details = {"duplicate": True, "currentState": previous.get("state"), "revision": previous.get("revision")}
                self._ack(command, accepted, None if accepted else "TASK_ALREADY_CANCELLED", details)
                return {"ok": accepted, "taskId": command["taskId"], **details}
            current = self.runtime.get("task")
            if current and current.get("state") in ACTIVE_STATES:
                return self._reject(command, "DEVICE_BUSY", {"currentTaskId": current.get("taskId")})
            recipe = self.catalog.get(command.get("recipeId", ""))
            if not recipe:
                return self._reject(command, "RECIPE_NOT_FOUND", {"recipeId": command.get("recipeId")})
            if not recipe.get("enabled", True):
                return self._reject(command, "RECIPE_DISABLED", {"recipeId": command.get("recipeId")})
            if command.get("recipeVersion") and command["recipeVersion"] != recipe["version"]:
                return self._reject(command, "RECIPE_VERSION_MISMATCH", {"requested": command["recipeVersion"], "installed": recipe["version"]})
            requirements = self.inventory.requirements(recipe)
            ok, detail = self.inventory.reserve(command["taskId"], requirements)
            if not ok:
                return self._reject(command, "MATERIAL_INSUFFICIENT", detail or {})
            execution_recipe = self.catalog.materialize_execution_recipe(recipe)
            planned_duration = sum(float(step["durationSeconds"]) for step in execution_recipe["steps"])
            task = {"taskId": command["taskId"], "orderId": command.get("orderId"), "orderNo": command.get("orderNo"), "messageId": command.get("messageId"), "recipe": execution_recipe, "state": "ACKNOWLEDGED", "stepIndex": 0, "stepProgress": 0.0, "overallProgress": 0.0, "stepElapsed": 0.0, "elapsedSeconds": 0.0, "remainingSeconds": planned_duration, "stepPrechecked": False, "attempt": 1, "stepRetries": {}, "plannedDurationSeconds": planned_duration, "message": "任务已接受，准备制作"}
            self._progress_reports[task["taskId"]] = (0.0, time.monotonic())
            self.runtime["task"] = task; self.runtime["deviceStatus"] = "RESERVED"
            self._persist_task(task)
            self._emit("inventory.reserved", "已预占整杯所需物料", {"taskId": task["taskId"], "orderId": task.get("orderId"), "messageId": task.get("messageId"), "taskRevision": task.get("revision"), "materials": requirements})
            step_plan = [{"stepId": step["id"], "stepName": step["name"], "stepIndex": index, "durationSeconds": step["durationSeconds"]} for index, step in enumerate(execution_recipe["steps"])]
            self._emit("task.acknowledged", "制作任务已接受", {**self._task_ref(task), **self._progress_ref(task), "messageId": task.get("messageId"), "plannedDurationSeconds": planned_duration, "stepPlan": step_plan, "stepDurations": step_plan})
            self._ack(command, True)
            self._inventory_changed()
            return {"ok": True, "taskId": task["taskId"]}

    def _reject(self, command: dict[str, Any], reason: str, details: dict[str, Any]) -> dict[str, Any]:
        self._emit("task.rejected", f"任务被拒绝：{reason}", {"taskId": command.get("taskId"), "orderId": command.get("orderId"), "reasonCode": reason, "details": details})
        self._ack(command, False, reason, details)
        return {"ok": False, "error": reason, "details": details}

    def _ack(self, command: dict[str, Any], accepted: bool, reason: str | None = None, details: dict[str, Any] | None = None) -> None:
        message_id = command.get("messageId")
        if not message_id:
            return
        completed_at = now()
        payload = {"messageId": message_id, "deviceId": self.device_id, "taskId": command.get("taskId"), "commandType": command.get("type"), "accepted": accepted, "status": "APPLIED" if accepted else "REJECTED", "acceptedAt": completed_at, "completedAt": completed_at}
        if reason:
            payload.update({"reasonCode": reason, "details": details or {}})
        elif details:
            payload["details"] = details
        self.store.complete_command(message_id, payload["status"], payload, queue_delivery=bool(self.cloud))

    def _complete_control_command(self, command: dict[str, Any], result: dict[str, Any]) -> None:
        message_id = command.get("messageId")
        if not message_id:
            return
        accepted = bool(result.get("ok"))
        payload = {
            "messageId": message_id,
            "deviceId": self.device_id,
            "taskId": command.get("taskId"),
            "commandType": command.get("type"),
            "accepted": accepted,
            "status": "APPLIED" if accepted else "REJECTED",
            "completedAt": now(),
        }
        if not accepted:
            payload["reasonCode"] = result.get("reasonCode", "COMMAND_REJECTED")
            payload["details"] = {key: value for key, value in result.items() if key != "ok"}
        else:
            payload["details"] = {key: value for key, value in result.items() if key != "ok"}
        self.store.complete_command(message_id, payload["status"], payload, queue_delivery=bool(self.cloud))

    def _persist_task(self, task: dict[str, Any]) -> None:
        self.store.save_job(task)

    # Local task commands
    def command(self, action: str) -> dict[str, Any]:
        if self.cloud and action not in {"toggle-offline"}:
            try:
                self.cloud.debug_command(action, now())
            except CloudError as exc:
                return {"ok": False, "error": f"后台命令失败：{exc}"}
            return {"ok": True, "message": "命令已发送后台，等待设备命令轮询返回"}
        return self._apply_command(action)

    def _apply_command(self, action: str, target_task_id: str | None = None) -> dict[str, Any]:
        with self.lock:
            if action == "toggle-offline":
                offline = not self.runtime["override"]["offline"]
                self.runtime["override"]["offline"] = offline
                self.runtime["connection"] = "OFFLINE" if offline else ("CONNECTING" if self.cloud else "ONLINE")
                self._emit("device.connection", "已模拟断网" if offline else "已恢复网络", queue=not offline)
                return {"ok": True}
            if action == "force-fail":
                self.failures.force_fail_next = True; self.runtime["override"]["forceFailNext"] = True
                self._emit("debug.failure-armed", "下一执行环节将强制失败")
                return {"ok": True}
            task = self.runtime.get("task")
            if not task:
                return {"ok": False, "reasonCode": "NO_ACTIVE_TASK", "error": "没有当前任务"}
            if target_task_id and target_task_id != task.get("taskId"):
                return {"ok": False, "reasonCode": "TASK_MISMATCH", "error": "命令目标不是当前任务", "currentTaskId": task.get("taskId"), "targetTaskId": target_task_id}
            if task.get("recoveryHold") and action in {"resume", "retry", "skip"}:
                return {"ok": False, "reasonCode": "RECOVERY_REQUIRES_RECONCILIATION", "error": "重启后的物理结果未知，需核对结果并受控取消旧任务，不能直接继续制作"}
            if action == "pause" and task["state"] == "RUNNING":
                task["state"] = "PAUSED"; task["message"] = "任务已暂停"; self._persist_task(task); self._emit("task.paused", task["message"], self._task_ref(task))
            elif action == "resume" and task["state"] == "PAUSED":
                task["state"] = "RUNNING"; task["message"] = "继续制作"; self.runtime["deviceStatus"] = "BUSY"; self._persist_task(task); self._emit("task.resumed", task["message"], self._task_ref(task))
            elif action == "skip" and task["state"] in {"RUNNING", "PAUSED"}:
                step = task["recipe"]["steps"][task["stepIndex"]]
                self.inventory.release(task["taskId"], self.inventory.requirements({"steps": [step]}))
                self._emit("step.skipped", f"已跳过 {step['name']}", {**self._task_ref(task), "stepId": step["id"]})
                self._advance_step(task)
            elif action == "retry" and task["state"] == "RETRY_WAIT":
                failure = task.get("failure", {})
                step_id = failure.get("stepId")
                retries_used = int(task.get("stepRetries", {}).get(step_id, 0))
                max_retries = int(failure.get("maxRetries", 0))
                if not failure.get("retryable") or retries_used >= max_retries:
                    return {"ok": False, "error": "该故障不可重试或已达到重试上限", "details": {"retriesUsed": retries_used, "maxRetries": max_retries}}
                requirements = self.inventory.requirements(task["recipe"], task["stepIndex"])
                ok, detail = self.inventory.reserve(task["taskId"], requirements)
                if not ok:
                    return {"ok": False, "error": "重试所需物料不足", "details": detail}
                task.setdefault("stepRetries", {})[step_id] = retries_used + 1
                task.update({"state": "RUNNING", "stepProgress": 0.0, "stepElapsed": 0.0, "stepPrechecked": False, "attempt": task.get("attempt", 1) + 1, "message": "任务重试"})
                self.runtime["deviceStatus"] = "BUSY"
                task.update(self._task_progress_fields(task))
                self._persist_task(task); self._emit("task.retry", "任务开始重试", self._task_ref(task)); self._inventory_changed()
            elif action == "cancel" and task["state"] in ACTIVE_STATES:
                self.inventory.release(task["taskId"]); task["state"] = "CANCELLED"; task["message"] = "任务已取消"; self.runtime["deviceStatus"] = "IDLE"; self._persist_task(task); self._emit("task.cancelled", task["message"], self._task_ref(task)); self._inventory_changed()
            elif action == "clear" and task["state"] in {"SUCCEEDED", "FAILED", "CANCELLED"}:
                self.runtime["task"] = None; self.runtime["deviceStatus"] = "IDLE"; self.store.clear_current_job(); self._emit("task.cleared", "终端返回待机")
            else:
                return {"ok": False, "reasonCode": "ILLEGAL_TASK_STATE", "error": "当前状态不支持该操作"}
            return {"ok": True}

    # Execution
    def _execution_loop(self) -> None:
        tick = 0.25
        while not self.stop_event.wait(tick):
            with self.lock:
                task = self.runtime.get("task")
                if not task or self.runtime["override"]["offline"]:
                    continue
                if task["state"] == "ACKNOWLEDGED":
                    task["state"] = "RUNNING"; self.runtime["deviceStatus"] = "BUSY"
                    self._persist_task(task)
                    self._emit("task.started", "开始制作", {**self._task_ref(task), **self._progress_ref(task)})
                if task["state"] != "RUNNING":
                    continue
                step = task["recipe"]["steps"][task["stepIndex"]]
                if not task["stepPrechecked"]:
                    failed, profile = self.failures.should_fail(step, "before")
                    self.runtime["override"]["forceFailNext"] = self.failures.force_fail_next
                    if failed:
                        self._fail_task(task, step, profile, consume=False); continue
                    task["stepPrechecked"] = True; task["message"] = step["name"]
                    self._persist_task(task)
                    self._emit("step.started", f"开始：{step['name']}", {**self._task_ref(task), **self._progress_ref(task)})
                task["stepElapsed"] += tick
                task["stepProgress"] = min(1.0, task["stepElapsed"] / float(step["durationSeconds"]))
                task.update(self._task_progress_fields(task))
                progress = self._progress_ref(task)
                if self._should_report_progress(task["taskId"], float(progress["overallProgress"])):
                    self._persist_task(task)
                    self._emit("task.progress", step["name"], {**self._task_ref(task), **progress, "progress": task["stepProgress"]})
                if task["stepProgress"] < 1:
                    continue
                failed, profile = self.failures.should_fail(step, "after")
                self.runtime["override"]["forceFailNext"] = self.failures.force_fail_next
                if failed:
                    self._fail_task(task, step, profile, consume=bool(profile.get("consumeOnFailure"))); continue
                self._consume_step(task, step)
                self._persist_task(task)
                self._emit("step.completed", f"完成：{step['name']}", {**self._task_ref(task), **self._progress_ref(task)})
                self._advance_step(task)

    def _consume_step(self, task: dict[str, Any], step: dict[str, Any]) -> None:
        changes = self.inventory.consume_step(task["taskId"], step["id"], step.get("consumes", []), attempt=int(task.get("attempt", 1)))
        for change in changes:
            self._emit("inventory.consumed", f"已消耗 {change['materialId']} {change['amount']} {change['unit']}", {**self._task_ref(task), "stepId": step["id"], "inventoryVersion": self.inventory.state["version"], **change})
        if changes:
            self._inventory_changed()

    def _fail_task(self, task: dict[str, Any], step: dict[str, Any], profile: dict[str, Any], consume: bool) -> None:
        if consume:
            self._consume_step(task, step)
        self.inventory.release(task["taskId"])
        retries_used = int(task.get("stepRetries", {}).get(step["id"], 0))
        max_retries = int(profile.get("maxRetries", 0))
        retryable = bool(profile.get("retryable")) and retries_used < max_retries
        task["state"] = "RETRY_WAIT" if retryable else "FAILED"
        task["message"] = profile["message"]
        task["failure"] = {"code": profile["errorCode"], "stepId": step["id"], "retryable": retryable, "retriesUsed": retries_used, "maxRetries": max_retries, "consumedOnFailure": consume}
        self.runtime["deviceStatus"] = "BUSY" if retryable else "FAILED"
        self._progress_reports.pop(task["taskId"], None)
        self._persist_task(task)
        self._emit("task.retry_wait" if retryable else "task.failed", task["message"], {**self._task_ref(task), "failure": task["failure"]})
        self._inventory_changed()

    def _advance_step(self, task: dict[str, Any]) -> None:
        task["stepIndex"] += 1
        if task["stepIndex"] >= len(task["recipe"]["steps"]):
            task["stepIndex"] = len(task["recipe"]["steps"]) - 1; task["stepProgress"] = 1.0; task["state"] = "SUCCEEDED"; task["message"] = "咖啡制作完成，请取杯"; self.runtime["deviceStatus"] = "READY"
            task.update(self._task_progress_fields(task))
            self.inventory.release(task["taskId"])
            self._progress_reports.pop(task["taskId"], None)
            self._persist_task(task)
            self._emit("task.succeeded", task["message"], {**self._task_ref(task), **self._progress_ref(task)}); self._inventory_changed()
        else:
            task.update({"stepProgress": 0.0, "stepElapsed": 0.0, "stepPrechecked": False})
            task.update(self._task_progress_fields(task))
            self._persist_task(task)

    @staticmethod
    def _task_ref(task: dict[str, Any]) -> dict[str, Any]:
        return {"taskId": task.get("taskId"), "orderId": task.get("orderId"), "recipeId": task.get("recipe", {}).get("recipeId"), "taskRevision": task.get("revision"), "attempt": task.get("attempt", 1)}

    def _should_report_progress(self, task_id: str, overall_progress: float, *, monotonic_now: float | None = None) -> bool:
        """Send on meaningful progress change, with a bounded quiet period."""
        current = time.monotonic() if monotonic_now is None else monotonic_now
        previous_progress, previous_at = self._progress_reports.get(task_id, (0.0, current))
        if overall_progress - previous_progress < self.progress_min_delta and current - previous_at < self.progress_max_interval:
            return False
        self._progress_reports[task_id] = (overall_progress, current)
        return True

    @staticmethod
    def _progress_ref(task: dict[str, Any]) -> dict[str, Any]:
        steps = task.get("recipe", {}).get("steps") or []
        if not steps:
            return {"stepId": None, "stepName": None, "stepIndex": 0, "stepCount": 0, "stepProgress": 0.0, "overallProgress": 0.0, "elapsedSeconds": 0.0, "remainingSeconds": 0.0}
        index = max(0, min(int(task.get("stepIndex", 0)), len(steps) - 1))
        step = steps[index]
        planned = float(task.get("plannedDurationSeconds") or sum(float(item["durationSeconds"]) for item in steps))
        completed = sum(float(item["durationSeconds"]) for item in steps[:index])
        step_progress = max(0.0, min(1.0, float(task.get("stepProgress", 0.0))))
        elapsed = min(planned, completed + float(step["durationSeconds"]) * step_progress)
        elapsed_rounded = round(elapsed, 2)
        remaining_rounded = round(max(0.0, planned - elapsed_rounded), 2)
        overall = 1.0 if task.get("state") == "SUCCEEDED" else (elapsed / planned if planned > 0 else 0.0)
        return {
            "stepId": step.get("id"), "stepName": step.get("name"), "stepIndex": index,
            "stepCount": len(steps), "stepProgress": step_progress,
            "overallProgress": max(0.0, min(1.0, overall)),
            "elapsedSeconds": elapsed_rounded, "remainingSeconds": remaining_rounded,
        }

    @classmethod
    def _task_progress_fields(cls, task: dict[str, Any]) -> dict[str, float]:
        progress = cls._progress_ref(task)
        return {key: progress[key] for key in ("overallProgress", "elapsedSeconds", "remainingSeconds")}

    def _inventory_changed(self) -> None:
        snapshot = self.inventory.snapshot()
        self.last_synced_inventory = -1
        self.last_synced_capability = None
        for item in snapshot["materials"]:
            previous = self.material_statuses.get(item["materialId"])
            self.material_statuses[item["materialId"]] = item["status"]
            if item["status"] in {"LOW", "CRITICAL"} and item["status"] != previous:
                self._emit(f"inventory.{item['status'].lower()}", f"物料告警：{item['name']} {item['status']}", item)
            elif previous in {"LOW", "CRITICAL"} and item["status"] == "OK":
                self._emit("inventory.recovered", f"物料恢复：{item['name']}", item)

    # Cloud coordination
    def _cloud_loop(self) -> None:
        if self.mqtt:
            self._mqtt_cloud_loop()
            return
        poll_seconds = float(self.config["backend"].get("commandPollSeconds", 2))
        heartbeat_seconds = float(self.config["backend"].get("heartbeatIntervalSeconds", 30))
        next_poll = next_heartbeat = next_display = 0.0
        failure_count = 0
        self.sync_health["threadAlive"] = True
        try:
            while not self.stop_event.wait(0.25):
                if self.runtime["override"]["offline"]:
                    continue
                clock = time.monotonic()
                try:
                    if clock >= next_poll:
                        self._poll_commands(); next_poll = clock + poll_seconds
                    if clock >= next_heartbeat:
                        response = self.cloud.heartbeat(self._heartbeat_payload())
                        if response.get("qrUrl"):
                            self.runtime["qrUrl"] = response["qrUrl"]
                        next_heartbeat = clock + heartbeat_seconds
                    if clock >= next_display:
                        try:
                            display = self.cloud.display_config()
                            if display.get("qrUrl"):
                                self.runtime["qrUrl"] = display["qrUrl"]; self.runtime["qrExpiresAt"] = display.get("qrExpiresAt")
                        except CloudError:
                            pass
                        next_display = clock + 30
                    self._flush_command_results(); self._sync_snapshots(); self._flush_outbox()
                    self.runtime["connection"] = "ONLINE"
                    self.sync_health.update({"lastSuccessAt": now(), "lastError": None})
                    failure_count = 0
                except CloudError as exc:
                    failure_count += 1
                    self.runtime["connection"] = "OFFLINE"
                    self.sync_health["lastError"] = str(exc)
                    self._emit("cloud.connection.failed", f"后台连接失败：{exc}", queue=False)
                    self.stop_event.wait(self._retry_delay(failure_count, base=min(2.0, poll_seconds)))
                except Exception as exc:  # keep the device agent observable and supervised
                    failure_count += 1
                    self.runtime["connection"] = "DEGRADED"
                    self.sync_health["lastError"] = f"{type(exc).__name__}: {exc}"
                    self._emit("cloud.worker.error", f"云端工作线程已隔离异常：{exc}", {"exceptionType": type(exc).__name__}, queue=False)
                    self.stop_event.wait(self._retry_delay(failure_count, base=1.0))
        finally:
            self.sync_health["threadAlive"] = False

    def _mqtt_cloud_loop(self) -> None:
        heartbeat_seconds = float(self.config["backend"].get("heartbeatIntervalSeconds", 30))
        # Spread a fleet's first heartbeat over one interval; otherwise a bulk
        # simulator start creates an avoidable broker/API burst.
        next_heartbeat = time.monotonic() + random.uniform(0, max(0.0, heartbeat_seconds))
        next_display = next_snapshot = next_cleanup = 0.0
        self.sync_health["threadAlive"] = True
        self.mqtt.start()
        try:
            while not self.stop_event.wait(0.1):
                if self.runtime["override"]["offline"]:
                    self.mqtt.suspend()
                    self.runtime["connection"] = "OFFLINE"
                    continue
                try:
                    self.mqtt.resume()
                    commands = self.mqtt.drain_commands()
                    if commands:
                        self._process_commands(commands)
                    clock = time.monotonic()
                    if self.mqtt.connected.is_set():
                        self._publish_mqtt_state_if_changed()
                    else:
                        self._last_mqtt_state_fingerprint = None
                    if clock >= next_heartbeat:
                        heartbeat = self._heartbeat_payload()
                        self.mqtt.publish("heartbeat", heartbeat, qos=0)
                        next_heartbeat = clock + heartbeat_seconds
                    self._flush_mqtt_command_results()
                    self._flush_mqtt_outbox()
                    if clock >= next_snapshot:
                        self._sync_snapshots()
                        next_snapshot = clock + 2
                    if clock >= next_display:
                        display = self.cloud.display_config()
                        if display.get("qrUrl"):
                            self.runtime["qrUrl"] = display["qrUrl"]
                            self.runtime["qrExpiresAt"] = display.get("qrExpiresAt")
                        next_display = clock + 30
                    if clock >= next_cleanup:
                        self.store.prune_deliveries()
                        next_cleanup = clock + 3600
                    if self.mqtt.connected.is_set():
                        self.runtime["connection"] = "ONLINE"
                        self.sync_health.update({"lastSuccessAt": now(), "lastError": None})
                    else:
                        self.runtime["connection"] = "CONNECTING"
                        self.sync_health["lastError"] = self.mqtt.last_error
                except (CloudError, MqttTransportError) as exc:
                    self.runtime["connection"] = "DEGRADED" if self.mqtt.connected.is_set() else "OFFLINE"
                    self.sync_health["lastError"] = str(exc)
                    self.stop_event.wait(self._retry_delay(1, base=0.5))
                except Exception as exc:
                    self.runtime["connection"] = "DEGRADED"
                    self.sync_health["lastError"] = f"{type(exc).__name__}: {exc}"
                    self._emit("cloud.worker.error", f"MQTT 工作线程异常：{exc}", {"exceptionType": type(exc).__name__}, queue=False)
                    self.stop_event.wait(1)
        finally:
            self.sync_health["threadAlive"] = False

    @staticmethod
    def _retry_delay(attempt: int, base: float = 1.0) -> float:
        ceiling = min(60.0, max(0.25, base) * (2 ** min(max(0, attempt - 1), 6)))
        return random.uniform(0.0, ceiling)

    def _poll_commands(self) -> None:
        response = self.cloud.commands(self.command_cursor)
        if not isinstance(response, dict):
            raise CloudError("命令响应必须是 JSON 对象", retryable=False)
        commands = response.get("commands", [])
        if not isinstance(commands, list):
            raise CloudError("commands 必须是数组", retryable=False)
        self._process_commands(commands)
        self.command_cursor = response.get("nextCursor", self.command_cursor)
        if self.command_cursor is not None and not isinstance(self.command_cursor, str):
            raise CloudError("nextCursor 必须是字符串或 null", retryable=False)
        self.store.set_meta("command_cursor", self.command_cursor)

    def _process_commands(self, commands: list[Any]) -> None:
        for raw_command in commands:
            if not isinstance(raw_command, dict):
                self._emit("command.malformed", "忽略非对象命令", {"valueType": type(raw_command).__name__}, queue=False)
                continue
            command = raw_command
            try:
                disposition, existing = self.store.record_command(command)
            except StateStoreError as exc:
                self._emit("command.malformed", str(exc), {"commandType": command.get("type")}, queue=False)
                continue
            if disposition == "CONFLICT":
                self._emit("command.id-conflict", "相同 messageId 的命令载荷不一致", {"messageId": command.get("messageId")}, queue=False)
                continue
            if disposition == "EXISTING" and existing and existing["state"] != "RECEIVED":
                continue
            command_type = command.get("type")
            try:
                if command_type == "MAKE_DRINK":
                    self._accept_task(command)
                elif command_type == "DEBUG_COMMAND":
                    result = self._apply_command(command.get("action", ""), command.get("taskId"))
                    self._complete_control_command(command, result)
                elif command_type == "RELOAD_CONFIG":
                    self._complete_control_command(command, self.reload_config())
                elif command_type == "INVENTORY_ADJUSTMENT":
                    self._complete_control_command(command, self.adjust_inventory(command.get("payload", {})))
                elif command_type == "CANCEL_TASK":
                    if not command.get("taskId"):
                        result = {"ok": False, "reasonCode": "INVALID_COMMAND", "error": "CANCEL_TASK 必须包含 taskId"}
                    else:
                        result = self._apply_command("cancel", str(command["taskId"]))
                    self._complete_control_command(command, result)
                else:
                    self._complete_control_command(command, {"ok": False, "reasonCode": "COMMAND_TYPE_UNSUPPORTED", "error": f"不支持的命令类型：{command_type}"})
            except Exception as exc:
                if command_type == "MAKE_DRINK":
                    self._ack(command, False, "COMMAND_PROCESSING_ERROR", {"exceptionType": type(exc).__name__})
                else:
                    self._complete_control_command(command, {"ok": False, "reasonCode": "COMMAND_PROCESSING_ERROR", "error": str(exc), "exceptionType": type(exc).__name__})
                self._emit("command.processing-failed", f"命令处理失败：{exc}", {"messageId": command.get("messageId"), "commandType": command_type}, queue=False)
    def _heartbeat_payload(self) -> dict[str, Any]:
        local_api = self.config.get("localApi", {})
        task = self.runtime.get("task") or {}
        with self.lock:
            self.sequence += 1
            sequence = self.sequence
        return {"deviceId": self.device_id, "messageId": f"hb-{self.boot_id}-{sequence}", "bootId": self.boot_id, "sequence": sequence, "instanceId": self.config["instanceId"], "storeId": self.config.get("storeId"), "deviceStatus": self.runtime["deviceStatus"], "currentTaskId": task.get("taskId"), "currentTaskState": task.get("state"), "currentTaskRevision": task.get("revision"), "capabilityVersion": self.catalog.version, "inventoryVersion": self.inventory.state["version"], "deliveries": self.store.delivery_stats(), "localApiUrl": f"http://{local_api.get('host', '127.0.0.1')}:{local_api.get('port', 9101)}" if local_api.get("enabled", True) else None, "appVersion": "1.2.0", "sentAt": now()}

    def _publish_mqtt_state_if_changed(self) -> None:
        """Retain one authoritative state snapshot; heartbeats need not duplicate it."""
        task = self.runtime.get("task") or {}
        fingerprint = (
            self.runtime["deviceStatus"], task.get("taskId"), task.get("state"),
        )
        if fingerprint == self._last_mqtt_state_fingerprint:
            return
        self._mqtt_state_revision += 1
        self.mqtt.publish_state({
            "deviceId": self.device_id,
            "bootId": self.boot_id,
            "stateRevision": self._mqtt_state_revision,
            "deviceStatus": self.runtime["deviceStatus"],
            "currentTaskId": task.get("taskId"),
            "currentTaskState": task.get("state"),
            "currentTaskRevision": task.get("revision"),
            "sentAt": now(),
        })
        self._last_mqtt_state_fingerprint = fingerprint

    def _sync_snapshots(self) -> None:
        capability_key = (self.catalog.version, int(self.inventory.state["version"]))
        if capability_key != self.last_synced_capability:
            self.cloud.sync_capabilities(self.capabilities()); self.last_synced_capability = capability_key
        inventory_version = int(self.inventory.state["version"])
        if inventory_version != self.last_synced_inventory:
            self.cloud.sync_inventory(self.inventory_snapshot()); self.last_synced_inventory = inventory_version

    def _flush_outbox(self) -> None:
        for record in self.store.pending_events():
            try:
                self.cloud.send_event(record["event"])
                self.store.mark_event_sent(record["eventId"])
            except CloudError as exc:
                if exc.status == 409:
                    self.store.mark_event_sent(record["eventId"])
                    continue
                delay = self._retry_delay(int(record["attempts"]) + 1)
                self.store.mark_event_failed(record["eventId"], str(exc), exc.retryable, delay)
                if exc.retryable:
                    raise
                self._emit("outbox.event.dead", "事件因永久错误进入死信", {"eventId": record["eventId"], "error": str(exc)}, queue=False)

    def _flush_command_results(self) -> None:
        for record in self.store.pending_command_results():
            result = record.get("result") or {}
            try:
                if record["type"] == "MAKE_DRINK":
                    self.cloud.ack(record.get("taskId") or "unknown", result)
                else:
                    self.cloud.command_result(record["messageId"], result)
                self.store.mark_command_result_sent(record["messageId"])
            except CloudError as exc:
                if exc.status == 409:
                    self.store.mark_command_result_sent(record["messageId"])
                    continue
                delay = self._retry_delay(int(record["attempts"]) + 1)
                self.store.mark_command_result_failed(record["messageId"], str(exc), exc.retryable, delay)
                if exc.retryable:
                    raise
                self._emit("outbox.command.dead", "命令结果因永久错误进入死信", {"messageId": record["messageId"], "error": str(exc)}, queue=False)

    def _flush_mqtt_outbox(self) -> None:
        for record in self.store.pending_events():
            event = record["event"]
            qos = 0 if event.get("type") == "task.progress" else 1
            try:
                self.mqtt.publish("event", event, qos=qos)
                self.store.mark_event_sent(record["eventId"])
            except MqttTransportError as exc:
                delay = self._retry_delay(int(record["attempts"]) + 1)
                self.store.mark_event_failed(record["eventId"], str(exc), True, delay)
                raise

    def _flush_mqtt_command_results(self) -> None:
        for record in self.store.pending_command_results():
            result = record.get("result") or {}
            try:
                self.mqtt.publish("command_result", result, qos=1)
                self.store.mark_command_result_sent(record["messageId"])
            except MqttTransportError as exc:
                delay = self._retry_delay(int(record["attempts"]) + 1)
                self.store.mark_command_result_failed(record["messageId"], str(exc), True, delay)
                raise


# Compatibility aliases for older imports.
HttpBackend = CoffeeDeviceRuntime
LocalBackend = CoffeeDeviceRuntime
