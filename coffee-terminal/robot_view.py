"""Public visual metadata for the frozen execution plan; never mutates inventory."""
from __future__ import annotations

import re
from typing import Any

ACTIONS = {"cups", "brew", "water", "milk", "ice", "syrup", "lid", "pickup", "wait", "latte-art"}


def step_plan(recipe: dict[str, Any], definitions: dict[str, Any]) -> list[dict[str, Any]]:
    result = []
    for index, step in enumerate(recipe.get("steps", [])):
        materials = [{"materialId": item["materialId"],
                      "name": definitions.get(item["materialId"], {}).get("name", item["materialId"]),
                      "amount": item["amount"], "unit": item["unit"]}
                     for item in step.get("consumes", [])]
        explicit = step.get("robotActions")
        if isinstance(explicit, list) and explicit and all(isinstance(action, str) and action in ACTIONS for action in explicit):
            actions = list(explicit)
        else:
            text = " ".join(str(step.get(key, "")) for key in ("id", "name", "animationCue")).lower()
            ingredients = " ".join(item["materialId"] + " " + item["name"] for item in materials).lower()
            actions = []
            if re.search(r"brew|extract|espresso|萃取|浓缩|coffee.beans|咖啡豆", text + " " + ingredients):
                actions.append("brew")
            for action, pattern in [("ice", r"ice|冰"), ("milk", r"milk|奶"), ("syrup", r"syrup|choco|糖浆|巧克力|可可")]:
                if re.search(pattern, text + " " + ingredients):
                    actions.append(action)
            if "brew" not in actions and re.search(r"water|水", text + " " + ingredients):
                actions.append("water")
            if re.search(r"lid|seal|封|盖", text + " " + ingredients):
                actions.append("lid")
            if re.search(r"serve|finish|出杯|出餐", text):
                actions.append("pickup")
            if not actions and re.search(r"cup|杯", text + " " + ingredients):
                actions.append("cups")
            if not actions:
                actions.append("wait")
        result.append({"stepId": step["id"], "stepName": step["name"], "stepIndex": index,
                       "durationSeconds": step["durationSeconds"], "dispenseChannel": step.get("dispenseChannel"),
                       "visual": {"version": 1, "actions": actions, "materials": materials, **({"latteArt": {key: step["latteArt"][key] for key in ("patternId", "patternVersion")}} if step.get("latteArt") else {}), **({"liquidReferenceMl": recipe["liquidReferenceMl"]} if recipe.get("liquidReferenceMl") else {})}})
    return result
