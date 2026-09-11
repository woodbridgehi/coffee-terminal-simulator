"""Versioned first-release latte art contract, validated before inventory reservation."""
import math

PATTERN = {"patternId": "spiral", "patternVersion": "1.0.0"}
MIN_DURATION = 24


def validate(recipe):
    errors = []
    previous = []
    count = 0
    for step in recipe.get("steps", []):
        if not isinstance(step, dict):
            continue
        actions = step.get("robotActions", [])
        if not isinstance(actions, list):
            continue
        art = step.get("latteArt")
        if "latte-art" not in actions:
            if count and any(a in actions for a in ("brew", "milk", "water", "syrup", "ice")):
                errors.append("拉花之后不可继续添加原料")
            if art is not None:
                errors.append("latteArt 必须用于独立的 latte-art 动作")
            previous.extend(actions)
            continue
        count += 1
        if actions != ["latte-art"] or art != PATTERN:
            errors.append("拉花必须是独立步骤，花型目前仅支持 spiral / 1.0.0")
        if recipe.get("optionSchema", {}).get("temperature") != "HOT":
            errors.append("首版拉花仅支持明确标记为 HOT 的配方")
        if "brew" not in previous or any(a in previous for a in ("ice", "lid", "pickup")):
            errors.append("拉花必须在萃取之后、封盖与出杯之前，且不可含冰")
        items = step.get("consumes", [])
        if (not isinstance(items, list) or len(items) != 1 or not isinstance(items[0], dict) or items[0].get("materialId") != "milk" or items[0].get("unit") != "ml"
                or type(items[0].get("amount")) not in (int, float)
                or not math.isfinite(items[0]["amount"]) or items[0]["amount"] <= 0):
            errors.append("拉花必须明确预占正数 ml 的 milk")
        if step.get("customizationRole") != "milk" or not step.get("dispenseChannel"):
            errors.append("拉花必须绑定 milk 定制选项及奶泡通道")
        duration = step.get("durationSeconds")
        randomization = step.get("durationRandomization")
        minimum = randomization.get("minSeconds", duration) if isinstance(randomization, dict) else duration
        if any(type(v) not in (int, float) or not math.isfinite(v) or v < MIN_DURATION for v in (duration, minimum)):
            errors.append("双臂拉花步骤至少需要 24 秒")
        previous.extend(actions)
    if count > 1:
        errors.append("首版每杯只允许一次拉花")
    return errors
