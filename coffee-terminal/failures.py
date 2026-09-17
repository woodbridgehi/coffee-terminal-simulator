from __future__ import annotations

from config_validation import loads, number
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
        candidate = loads(self.path.read_text(encoding="utf-8"))
        if not isinstance(candidate, dict):
            raise ValueError("failure policy must be an object")
        number(candidate.get("globalFailureRate", 0), "globalFailureRate", maximum=1)
        for group in ("profiles", "stepOverrides"):
            entries = candidate.get(group, {})
            if not isinstance(entries, dict):
                raise ValueError(f"{group} must be an object")
            for key, profile in entries.items():
                if not isinstance(profile, dict):
                    raise ValueError(f"{group}.{key} must be an object")
                number(profile.get("failureRate", 0), f"{key}.failureRate", maximum=1)
                retries = profile.get("maxRetries", 0)
                if type(retries) is not int or retries < 0:
                    raise ValueError(f"{key}.maxRetries must be a non-negative integer")
                if profile.get("timing", "after") not in {"before", "after"}:
                    raise ValueError(f"{key}.timing must be before or after")
                for field in ("retryable", "consumeOnFailure"):
                    if field in profile and not isinstance(profile[field], bool):
                        raise ValueError(f"{key}.{field} must be boolean")
        self.payload = candidate

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
