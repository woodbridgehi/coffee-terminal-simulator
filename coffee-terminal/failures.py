from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any


class FailurePolicy:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.payload: dict[str, Any] = {}
        self.runtime_failure_rate = 0.0
        self.force_fail_next = False
        self.reload()

    def reload(self) -> None:
        self.payload = json.loads(self.path.read_text(encoding="utf-8"))

    def profile(self, step: dict[str, Any]) -> dict[str, Any]:
        base = dict(self.payload.get("profiles", {}).get(step.get("failureProfile"), {}))
        override = self.payload.get("stepOverrides", {}).get(step.get("id"), {})
        base.update(override)
        base.setdefault("failureRate", 0)
        base.setdefault("errorCode", "SIMULATED_STEP_FAILURE")
        base.setdefault("message", f"{step.get('name', '步骤')}失败")
        base.setdefault("retryable", False)
        base.setdefault("maxRetries", 0)
        base.setdefault("timing", "after")
        base.setdefault("consumeOnFailure", base["timing"] == "after")
        return base

    def should_fail(self, step: dict[str, Any], timing: str) -> tuple[bool, dict[str, Any]]:
        profile = self.profile(step)
        if profile["timing"] != timing:
            return False, profile
        if self.force_fail_next:
            self.force_fail_next = False
            return True, profile
        global_rate = max(float(self.payload.get("globalFailureRate", 0)), float(self.runtime_failure_rate))
        profile_rate = float(profile.get("failureRate", 0))
        combined = 1 - (1 - global_rate) * (1 - profile_rate)
        return random.random() < combined, profile
