"""Local device runtime with optional real cloud connectivity."""
from __future__ import annotations

import json
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
from failures import FailurePolicy
from inventory import InventoryError, InventoryManager
from local_api import DeviceApiServer


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


ACTIVE_STATES = {"RECEIVED", "VALIDATING", "ACKNOWLEDGED", "RUNNING", "PAUSED", "RETRY_WAIT"}


class CoffeeDeviceRuntime:
    def __init__(self, config: dict[str, Any], instance_dir: Path) -> None:
        self.config = config
        self.instance_dir = instance_dir
        self.device_id = config["deviceId"]
        self.mode = config.get("backend", {}).get("mode", "remote")
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.boot_id = str(uuid.uuid4())
        self.sequence = 0
        self.events: list[dict[str, Any]] = []
        self.outbox: list[dict[str, Any]] = []
        self.command_cursor: str | None = None
        self.seen_commands: set[str] = set()
        self.last_synced_capability: tuple[str, int] | None = None
        self.last_synced_inventory = -1

        self.inventory = InventoryManager(instance_dir / "materials.json", instance_dir / "state" / "inventory.json")
        self.material_statuses = {item["materialId"]: item["status"] for item in self.inventory.snapshot()["materials"]}
        self.catalog = RecipeCatalog(instance_dir / "recipes", self.inventory)
        self.failures = FailurePolicy(instance_dir / "failures.json")
        backend_url = config.get("backend", {}).get("baseUrl", "http://localhost:8080").rstrip("/")
        self.runtime: dict[str, Any] = {
            "deviceStatus": "IDLE",
            "connection": "CONNECTING" if self.mode == "remote" else "ONLINE",
            "qrUrl": f"{backend_url}/order?device_id={self.device_id}",
            "qrExpiresAt": None,
            "task": None,
            "override": {"globalFailureRate": 0.0, "forceFailNext": False, "offline": False, "eventDelayMs": 0},
            "events": self.events,
        }
        self.cloud = CloudClient(config) if self.mode == "remote" else None
        self.local_api: DeviceApiServer | None = None
        local_api = config.get("localApi", {})
        if local_api.get("enabled", True):
            self.local_api = DeviceApiServer(self, local_api.get("host", "127.0.0.1"), int(local_api.get("port", 9101)))
            self.local_api.start()
        self._emit("device.online", "设备运行时已启动", queue=False)
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
                self.outbox.append(event)
            return event

    def close(self) -> None:
        """Stop background work and release the per-instance local API port."""
        self.stop_event.set()
        if self.local_api:
            self.local_api.stop()
        for thread in self.background_threads:
            thread.join(timeout=self.cloud.timeout + 1 if self.cloud else 2)

    @staticmethod
    def _qr_data_url(value: str) -> str:
        if not value:
            return ""
        image = qrcode.make(value, border=2)
        buffer = BytesIO(); image.save(buffer, format="PNG")
        return "data:image/png;base64," + b64encode(buffer.getvalue()).decode("ascii")

    # pywebview and local API reads
    def get_state(self) -> dict[str, Any]:
        with self.lock:
            runtime = dict(self.runtime)
            runtime["events"] = list(self.events)
            runtime["qrDataUrl"] = self._qr_data_url(runtime.get("qrUrl", ""))
            runtime["inventory"] = self.inventory.snapshot()
            return {"config": self.config, "recipes": self.catalog.list(), "capabilities": self.capabilities(), "runtime": runtime, "backend": {"mode": self.mode, "baseUrl": self.config.get("backend", {}).get("baseUrl")}}

    def health(self) -> dict[str, Any]:
        return {"ok": True, "deviceId": self.device_id, "bootId": self.boot_id, "connection": self.runtime["connection"], "deviceStatus": self.runtime["deviceStatus"], "time": now()}

    def capabilities(self) -> dict[str, Any]:
        result = self.catalog.capabilities(self.device_id, self.config.get("storeId", ""))
        result["generatedAt"] = now()
        return result

    def inventory_snapshot(self) -> dict[str, Any]:
        return {"deviceId": self.device_id, **self.inventory.snapshot()}

    def status(self) -> dict[str, Any]:
        return {"deviceId": self.device_id, "instanceId": self.config["instanceId"], "storeId": self.config.get("storeId"), "connection": self.runtime["connection"], "deviceStatus": self.runtime["deviceStatus"], "currentTask": self.runtime["task"], "capabilityVersion": self.catalog.version, "inventoryVersion": self.inventory.state["version"]}

    # Configuration and operator actions
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
        return self._accept_task({"messageId": f"local-{uuid.uuid4()}", "type": "MAKE_DRINK", "taskId": f"task-{uuid.uuid4().hex[:10]}", "orderId": f"order-{uuid.uuid4().hex[:6]}", "recipeId": recipe_id})

    def _accept_task(self, command: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            if not command.get("taskId") or not command.get("recipeId"):
                return self._reject(command, "INVALID_COMMAND", {"required": ["taskId", "recipeId"]})
            if command.get("expiresAt"):
                try:
                    expires_at = datetime.fromisoformat(command["expiresAt"].replace("Z", "+00:00"))
                    if expires_at <= datetime.now(timezone.utc):
                        return self._reject(command, "COMMAND_EXPIRED", {"expiresAt": command["expiresAt"]})
                except (TypeError, ValueError):
                    return self._reject(command, "INVALID_COMMAND", {"field": "expiresAt"})
            current = self.runtime.get("task")
            if current and current.get("state") in ACTIVE_STATES:
                return self._reject(command, "DEVICE_BUSY", {"currentTaskId": current.get("taskId")})
            recipe = self.catalog.get(command.get("recipeId", ""))
            if not recipe:
                return self._reject(command, "RECIPE_NOT_FOUND", {"recipeId": command.get("recipeId")})
            if command.get("recipeVersion") and command["recipeVersion"] != recipe["version"]:
                return self._reject(command, "RECIPE_VERSION_MISMATCH", {"requested": command["recipeVersion"], "installed": recipe["version"]})
            requirements = self.inventory.requirements(recipe)
            ok, detail = self.inventory.reserve(command["taskId"], requirements)
            if not ok:
                return self._reject(command, "MATERIAL_INSUFFICIENT", detail or {})
            execution_recipe = self.catalog.materialize_execution_recipe(recipe)
            planned_duration = sum(float(step["durationSeconds"]) for step in execution_recipe["steps"])
            task = {"taskId": command["taskId"], "orderId": command.get("orderId"), "messageId": command.get("messageId"), "recipe": execution_recipe, "state": "ACKNOWLEDGED", "stepIndex": 0, "stepProgress": 0.0, "stepElapsed": 0.0, "stepPrechecked": False, "attempt": 1, "stepRetries": {}, "plannedDurationSeconds": planned_duration, "lastProgressBucket": -1, "message": "任务已接受，准备制作"}
            self.runtime["task"] = task; self.runtime["deviceStatus"] = "RESERVED"
            self._emit("inventory.reserved", "已预占整杯所需物料", {"taskId": task["taskId"], "orderId": task.get("orderId"), "materials": requirements})
            self._emit("task.acknowledged", "制作任务已接受", {"taskId": task["taskId"], "orderId": task.get("orderId"), "plannedDurationSeconds": planned_duration, "stepDurations": [{"stepId": step["id"], "durationSeconds": step["durationSeconds"]} for step in execution_recipe["steps"]]})
            self._ack(command, True)
            self._inventory_changed()
            return {"ok": True, "taskId": task["taskId"]}

    def _reject(self, command: dict[str, Any], reason: str, details: dict[str, Any]) -> dict[str, Any]:
        self._emit("task.rejected", f"任务被拒绝：{reason}", {"taskId": command.get("taskId"), "orderId": command.get("orderId"), "reasonCode": reason, "details": details})
        self._ack(command, False, reason, details)
        return {"ok": False, "error": reason, "details": details}

    def _ack(self, command: dict[str, Any], accepted: bool, reason: str | None = None, details: dict[str, Any] | None = None) -> None:
        if not self.cloud:
            return
        payload = {"messageId": command.get("messageId"), "deviceId": self.device_id, "accepted": accepted, "acceptedAt": now()}
        if reason:
            payload.update({"reasonCode": reason, "details": details or {}})
        try:
            self.cloud.ack(command.get("taskId", "unknown"), payload)
        except CloudError as exc:
            self._emit("task.ack.failed", f"任务 ACK 上报失败：{exc}", payload, queue=False)

    # Local task commands
    def command(self, action: str) -> dict[str, Any]:
        if self.cloud and action not in {"toggle-offline"}:
            try:
                self.cloud.debug_command(action, now())
            except CloudError as exc:
                return {"ok": False, "error": f"后台命令失败：{exc}"}
            return {"ok": True, "message": "命令已发送后台，等待设备命令轮询返回"}
        return self._apply_command(action)

    def _apply_command(self, action: str) -> dict[str, Any]:
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
                return {"ok": False, "error": "没有当前任务"}
            if action == "pause" and task["state"] == "RUNNING":
                task["state"] = "PAUSED"; task["message"] = "任务已暂停"; self._emit("task.paused", task["message"], self._task_ref(task))
            elif action == "resume" and task["state"] == "PAUSED":
                task["state"] = "RUNNING"; task["message"] = "继续制作"; self._emit("task.resumed", task["message"], self._task_ref(task))
            elif action == "skip" and task["state"] in {"RUNNING", "PAUSED"}:
                step = task["recipe"]["steps"][task["stepIndex"]]
                self.inventory.release(task["taskId"], self.inventory.requirements({"steps": [step]}))
                self._emit("step.skipped", f"已跳过 {step['name']}", {**self._task_ref(task), "stepId": step["id"]})
                self._advance_step(task)
            elif action == "retry" and task["state"] == "FAILED":
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
                self._emit("task.retry", "任务开始重试", self._task_ref(task)); self._inventory_changed()
            elif action == "cancel" and task["state"] in ACTIVE_STATES:
                self.inventory.release(task["taskId"]); task["state"] = "CANCELLED"; task["message"] = "任务已取消"; self.runtime["deviceStatus"] = "IDLE"; self._emit("task.cancelled", task["message"], self._task_ref(task)); self._inventory_changed()
            elif action == "clear" and task["state"] in {"SUCCEEDED", "FAILED", "CANCELLED"}:
                self.runtime["task"] = None; self.runtime["deviceStatus"] = "IDLE"; self._emit("task.cleared", "终端返回待机")
            else:
                return {"ok": False, "error": "当前状态不支持该操作"}
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
                    self._emit("task.started", "开始制作", self._task_ref(task))
                if task["state"] != "RUNNING":
                    continue
                step = task["recipe"]["steps"][task["stepIndex"]]
                if not task["stepPrechecked"]:
                    failed, profile = self.failures.should_fail(step, "before")
                    self.runtime["override"]["forceFailNext"] = self.failures.force_fail_next
                    if failed:
                        self._fail_task(task, step, profile, consume=False); continue
                    task["stepPrechecked"] = True; task["message"] = step["name"]
                    self._emit("step.started", f"开始：{step['name']}", {**self._task_ref(task), "stepId": step["id"]})
                task["stepElapsed"] += tick
                task["stepProgress"] = min(1.0, task["stepElapsed"] / float(step["durationSeconds"]))
                bucket = int(task["stepProgress"] * 10)
                if bucket != task["lastProgressBucket"]:
                    task["lastProgressBucket"] = bucket
                    self._emit("task.progress", step["name"], {**self._task_ref(task), "stepId": step["id"], "stepIndex": task["stepIndex"], "progress": task["stepProgress"]})
                if task["stepProgress"] < 1:
                    continue
                failed, profile = self.failures.should_fail(step, "after")
                self.runtime["override"]["forceFailNext"] = self.failures.force_fail_next
                if failed:
                    self._fail_task(task, step, profile, consume=bool(profile.get("consumeOnFailure"))); continue
                self._consume_step(task, step)
                self._emit("step.completed", f"完成：{step['name']}", {**self._task_ref(task), "stepId": step["id"]})
                self._advance_step(task)

    def _consume_step(self, task: dict[str, Any], step: dict[str, Any]) -> None:
        changes = self.inventory.consume_step(task["taskId"], step["id"], step.get("consumes", []))
        for change in changes:
            self._emit("inventory.consumed", f"已消耗 {change['materialId']} {change['amount']} {change['unit']}", {**self._task_ref(task), "stepId": step["id"], **change})
        if changes:
            self._inventory_changed()

    def _fail_task(self, task: dict[str, Any], step: dict[str, Any], profile: dict[str, Any], consume: bool) -> None:
        if consume:
            self._consume_step(task, step)
        self.inventory.release(task["taskId"])
        task["state"] = "FAILED"; task["message"] = profile["message"]
        retries_used = int(task.get("stepRetries", {}).get(step["id"], 0))
        max_retries = int(profile.get("maxRetries", 0))
        task["failure"] = {"code": profile["errorCode"], "stepId": step["id"], "retryable": bool(profile.get("retryable")) and retries_used < max_retries, "retriesUsed": retries_used, "maxRetries": max_retries, "consumedOnFailure": consume}
        self.runtime["deviceStatus"] = "FAILED"
        self._emit("task.failed", task["message"], {**self._task_ref(task), "failure": task["failure"]})
        self._inventory_changed()

    def _advance_step(self, task: dict[str, Any]) -> None:
        task["stepIndex"] += 1
        if task["stepIndex"] >= len(task["recipe"]["steps"]):
            task["stepIndex"] = len(task["recipe"]["steps"]) - 1; task["stepProgress"] = 1.0; task["state"] = "SUCCEEDED"; task["message"] = "咖啡制作完成，请取杯"; self.runtime["deviceStatus"] = "READY"
            self.inventory.release(task["taskId"])
            self._emit("task.succeeded", task["message"], self._task_ref(task)); self._inventory_changed()
        else:
            task.update({"stepProgress": 0.0, "stepElapsed": 0.0, "stepPrechecked": False, "lastProgressBucket": -1})

    @staticmethod
    def _task_ref(task: dict[str, Any]) -> dict[str, Any]:
        return {"taskId": task.get("taskId"), "orderId": task.get("orderId"), "recipeId": task.get("recipe", {}).get("recipeId")}

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
        poll_seconds = float(self.config["backend"].get("commandPollSeconds", 2))
        heartbeat_seconds = float(self.config["backend"].get("heartbeatIntervalSeconds", 30))
        next_poll = next_heartbeat = next_display = 0.0
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
                self._sync_snapshots(); self._flush_outbox()
                self.runtime["connection"] = "ONLINE"
            except CloudError as exc:
                self.runtime["connection"] = "OFFLINE"
                self._emit("cloud.connection.failed", f"后台连接失败：{exc}", queue=False)
                self.stop_event.wait(min(2.0, poll_seconds))

    def _poll_commands(self) -> None:
        response = self.cloud.commands(self.command_cursor)
        for command in response.get("commands", []):
            message_id = command.get("messageId")
            if message_id in self.seen_commands:
                continue
            self.seen_commands.add(message_id)
            command_type = command.get("type")
            if command_type == "MAKE_DRINK":
                self._accept_task(command)
            elif command_type == "DEBUG_COMMAND":
                self._apply_command(command.get("action", ""))
            elif command_type == "RELOAD_CONFIG":
                self.reload_config()
            elif command_type == "INVENTORY_ADJUSTMENT":
                self.adjust_inventory(command.get("payload", {}))
            elif command_type == "CANCEL_TASK":
                self._apply_command("cancel")
        self.command_cursor = response.get("nextCursor", self.command_cursor)

    def _heartbeat_payload(self) -> dict[str, Any]:
        local_api = self.config.get("localApi", {})
        return {"deviceId": self.device_id, "instanceId": self.config["instanceId"], "storeId": self.config.get("storeId"), "deviceStatus": self.runtime["deviceStatus"], "currentTaskId": (self.runtime.get("task") or {}).get("taskId"), "capabilityVersion": self.catalog.version, "inventoryVersion": self.inventory.state["version"], "localApiUrl": f"http://{local_api.get('host', '127.0.0.1')}:{local_api.get('port', 9101)}" if local_api.get("enabled", True) else None, "appVersion": "0.3.0", "sentAt": now()}

    def _sync_snapshots(self) -> None:
        capability_key = (self.catalog.version, int(self.inventory.state["version"]))
        if capability_key != self.last_synced_capability:
            self.cloud.sync_capabilities(self.capabilities()); self.last_synced_capability = capability_key
        inventory_version = int(self.inventory.state["version"])
        if inventory_version != self.last_synced_inventory:
            self.cloud.sync_inventory(self.inventory_snapshot()); self.last_synced_inventory = inventory_version

    def _flush_outbox(self) -> None:
        while self.outbox:
            self.cloud.send_event(self.outbox[0])
            self.outbox.pop(0)


# Compatibility aliases for older imports.
HttpBackend = CoffeeDeviceRuntime
LocalBackend = CoffeeDeviceRuntime
