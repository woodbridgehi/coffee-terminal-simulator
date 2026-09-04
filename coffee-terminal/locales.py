from __future__ import annotations

from typing import Any


SUPPORTED_LOCALES = ("zh-CN", "en-US")


def normalize_locale(value: Any, default: str = "zh-CN") -> str:
    raw = str(value or "").strip().replace("_", "-").lower()
    if raw in {"zh", "zh-cn", "zh-hans", "zh-sg"}:
        return "zh-CN"
    if raw == "en" or raw.startswith("en-"):
        return "en-US"
    return default if default in SUPPORTED_LOCALES else "zh-CN"
