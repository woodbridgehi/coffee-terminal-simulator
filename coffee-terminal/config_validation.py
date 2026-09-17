"""Strict configuration primitives shared by all configuration entry points."""
import json
import math


def loads(value):
    def reject(value):
        raise ValueError(f"Non-finite JSON number: {value}")
    def finite_float(value):
        parsed = float(value)
        if not math.isfinite(parsed):
            reject(value)
        return parsed
    return json.loads(value, parse_constant=reject, parse_float=finite_float)


def number(value, field, minimum=0, maximum=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{field} must be a finite number")
    if value < minimum or (maximum is not None and value > maximum):
        raise ValueError(f"{field} is out of range")
    return value
