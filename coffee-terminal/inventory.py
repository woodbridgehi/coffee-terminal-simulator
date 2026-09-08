from __future__ import annotations

import json
import math
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class InventoryError(ValueError):
    pass


class InventoryManager:
    def __init__(self, definitions_path: Path, state_path: Path, *, clear_reservations: bool = True, state_store=None) -> None:
        self.definitions_path = definitions_path
        self.state_path = state_path
        self.state_store = state_store
        self.lock = state_store.lock if state_store else threading.RLock()
        self.definitions: dict[str, dict[str, Any]] = {}
        self.state: dict[str, Any] = {}
        self.reload(clear_reservations=clear_reservations)

    def reload(self, clear_reservations: bool = False) -> None:
        with self.lock:
            payload = json.loads(self.definitions_path.read_text(encoding="utf-8"))
            definitions = {item["materialId"]: item for item in payload.get("materials", [])}
            if len(definitions) != len(payload.get("materials", [])):
                raise InventoryError("materials.json 中存在重复 materialId")
            previous = self._load_state()
            items = previous.get("items", {})
            for material_id, definition in definitions.items():
                existing = items.get(material_id)
                if existing and existing.get("unit") != definition["unit"]:
                    raise InventoryError(f"物料 {material_id} 的单位不能从 {existing.get('unit')} 改为 {definition['unit']}")
                items.setdefault(material_id, {"unit": definition["unit"], "onHand": float(definition.get("initialOnHand", 0)), "reserved": 0.0})
            reservations = {} if clear_reservations else {
                task_id: {material_id: float(amount) for material_id, amount in reservation.items() if material_id in definitions and float(amount) > 0}
                for task_id, reservation in previous.get("reservations", {}).items()
            }
            reservations = {task_id: reservation for task_id, reservation in reservations.items() if reservation}
            for item in items.values():
                item["reserved"] = 0.0
            for reservation in reservations.values():
                for material_id, amount in reservation.items():
                    items[material_id]["reserved"] += amount
            self.definitions = definitions
            self.state = {
                "version": int(previous.get("version", 1)),
                "updatedAt": previous.get("updatedAt") or now(),
                "items": {key: value for key, value in items.items() if key in definitions},
                "reservations": reservations,
                "consumedKeys": previous.get("consumedKeys", []),
            }
            self._save()

    def _load_state(self) -> dict[str, Any]:
        if self.state_store:
            stored = self.state_store.get_meta("inventory_state")
            if stored is not None:
                return stored
        # Import a legacy JSON inventory exactly once; SQLite owns it afterwards.
        if not self.state_path.exists():
            return {}
        return json.loads(self.state_path.read_text(encoding="utf-8"))

    def _save(self) -> None:
        if self.state_store:
            self.state["updatedAt"] = now()
            self.state_store.set_meta("inventory_state", self.state)
            return
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.state["updatedAt"] = now()
        temporary = self.state_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.state, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(self.state_path)

    @staticmethod
    def requirements(recipe: dict[str, Any], start_step: int = 0) -> dict[str, float]:
        total: dict[str, float] = {}
        for step in recipe.get("steps", [])[start_step:]:
            for item in step.get("consumes", []):
                total[item["materialId"]] = total.get(item["materialId"], 0.0) + float(item["amount"])
        return total

    def validate_recipe(self, recipe: dict[str, Any]) -> list[str]:
        errors = []
        for step in recipe.get("steps", []):
            for item in step.get("consumes", []):
                definition = self.definitions.get(item.get("materialId"))
                if not definition:
                    errors.append(f"未知物料 {item.get('materialId')}")
                elif definition["unit"] != item.get("unit"):
                    errors.append(f"物料 {item['materialId']} 单位应为 {definition['unit']}")
                elif float(item.get("amount", 0)) <= 0:
                    errors.append(f"物料 {item['materialId']} 消耗量必须大于 0")
        return errors

    def can_reserve(self, requirements: dict[str, float]) -> tuple[bool, dict[str, Any] | None]:
        with self.lock:
            for material_id, amount in requirements.items():
                definition = self.definitions.get(material_id)
                item = self.state["items"].get(material_id)
                available = float(item["onHand"]) - float(item.get("reserved", 0)) if item else 0
                if not definition or not definition.get("enabled", True) or available + 1e-9 < amount:
                    return False, {"materialId": material_id, "required": amount, "available": max(0, available), "unit": definition.get("unit") if definition else None}
            return True, None

    def reserve(self, task_id: str, requirements: dict[str, float]) -> tuple[bool, dict[str, Any] | None]:
        with self.lock:
            ok, detail = self.can_reserve(requirements)
            if not ok:
                return False, detail
            current = self.state["reservations"].setdefault(task_id, {})
            for material_id, amount in requirements.items():
                self.state["items"][material_id]["reserved"] += amount
                current[material_id] = current.get(material_id, 0.0) + amount
            self._bump()
            return True, None

    def consume_step(self, task_id: str, step_id: str, consumes: list[dict[str, Any]], *, attempt: int = 1) -> list[dict[str, Any]]:
        key = f"{task_id}:{step_id}:{attempt}"
        with self.lock:
            if key in self.state["consumedKeys"]:
                return []
            # Validate the complete step before changing any material or idempotency key.
            totals: dict[str, float] = {}
            reservation = self.state["reservations"].get(task_id, {})
            for consumption in consumes:
                material_id = consumption.get("materialId")
                item = self.state["items"].get(material_id)
                amount = float(consumption.get("amount", 0))
                if not item or consumption.get("unit") != item["unit"] or not math.isfinite(amount) or amount <= 0:
                    raise InventoryError(f"无效的扣料参数：{material_id}")
                totals[material_id] = totals.get(material_id, 0) + amount
            for material_id, amount in totals.items():
                item = self.state["items"][material_id]
                if (not math.isfinite(float(item["onHand"])) or
                        float(item["onHand"]) + 1e-9 < amount or
                        float(reservation.get(material_id, 0)) + 1e-9 < amount or
                        float(item["onHand"]) + 1e-9 < float(item["reserved"])):
                    raise InventoryError(f"库存或任务预占不足，停止扣料并核查：{material_id}")
            changes = []
            reservation = self.state["reservations"].setdefault(task_id, {})
            for consumption in consumes:
                material_id = consumption["materialId"]
                amount = float(consumption["amount"])
                item = self.state["items"][material_id]
                before = float(item["onHand"])
                # Only rounding residue can be negative after the preflight above.
                item["onHand"] = max(0.0, before - amount)
                released = min(float(reservation.get(material_id, 0)), amount)
                reservation[material_id] = max(0.0, float(reservation.get(material_id, 0)) - released)
                item["reserved"] = max(0.0, float(item.get("reserved", 0)) - released)
                changes.append({"materialId": material_id, "amount": amount, "unit": item["unit"], "before": before, "remaining": item["onHand"]})
            self.state["consumedKeys"].append(key)
            self.state["consumedKeys"] = self.state["consumedKeys"][-1000:]
            self._bump()
            return changes

    def release(self, task_id: str, amounts: dict[str, float] | None = None) -> list[dict[str, Any]]:
        with self.lock:
            reservation = self.state["reservations"].get(task_id, {})
            targets = amounts or dict(reservation)
            changes = []
            for material_id, requested in targets.items():
                released = min(float(reservation.get(material_id, 0)), float(requested))
                if released <= 0:
                    continue
                reservation[material_id] -= released
                self.state["items"][material_id]["reserved"] = max(0.0, float(self.state["items"][material_id].get("reserved", 0)) - released)
                changes.append({"materialId": material_id, "amount": released, "unit": self.state["items"][material_id]["unit"]})
            if not any(float(value) > 0 for value in reservation.values()):
                self.state["reservations"].pop(task_id, None)
            self._bump()
            return changes

    def adjust(self, material_id: str, mode: str, amount: float) -> dict[str, Any]:
        with self.lock:
            if material_id not in self.definitions:
                raise InventoryError(f"未知物料：{material_id}")
            normalized_mode = mode.upper()
            if normalized_mode not in {"ADD", "SET"}:
                raise InventoryError("库存调整 mode 只允许 ADD 或 SET")
            definition = self.definitions[material_id]
            item = self.state["items"][material_id]
            before = float(item["onHand"])
            after = amount if normalized_mode == "SET" else before + amount
            if not math.isfinite(amount) or not math.isfinite(after) or after < 0 or after > float(definition["capacity"]):
                raise InventoryError(f"调整后数量必须在 0 到 {definition['capacity']} 之间")
            if after < float(item.get("reserved", 0)):
                raise InventoryError("调整后库存不能低于已预占量，请先核查并处理受影响任务")
            item["onHand"] = after
            self._bump()
            return {"materialId": material_id, "mode": normalized_mode, "amount": amount, "before": before, "after": after, "unit": definition["unit"]}

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            materials = []
            for material_id, definition in self.definitions.items():
                item = self.state["items"][material_id]
                on_hand = float(item["onHand"])
                reserved = float(item.get("reserved", 0))
                if on_hand <= float(definition["criticalThreshold"]):
                    status = "CRITICAL"
                elif on_hand <= float(definition["lowThreshold"]):
                    status = "LOW"
                else:
                    status = "OK"
                materials.append({**definition, "onHand": on_hand, "reserved": reserved, "available": max(0.0, on_hand - reserved), "status": status})
            return {"inventoryVersion": self.state["version"], "updatedAt": self.state["updatedAt"], "materials": materials}

    def max_servings(self, recipe: dict[str, Any]) -> int:
        requirements = self.requirements(recipe)
        if not requirements:
            return 9999
        snapshot = {item["materialId"]: item for item in self.snapshot()["materials"]}
        return max(0, min(int(snapshot[mid]["available"] // amount) if mid in snapshot and amount > 0 else 0 for mid, amount in requirements.items()))

    def _bump(self) -> None:
        self.state["version"] = int(self.state.get("version", 0)) + 1
        self._save()
