from __future__ import annotations

import hashlib
import json
import random
from copy import deepcopy
from pathlib import Path
from typing import Any

from inventory import InventoryManager

VISUAL_PROFILES = {"americano", "espresso", "iced-latte", "hazelnut-special", "generic"}
ANIMATION_CUES = {"cup-arrive", "ice-drop", "brew-stream", "water-pour", "milk-pour", "syrup-swirl", "seal", "serve", "idle"}


class RecipeCatalog:
    def __init__(self, recipes_dir: Path, inventory: InventoryManager) -> None:
        self.recipes_dir = recipes_dir
        self.inventory = inventory
        self.recipes: dict[str, dict[str, Any]] = {}
        self.invalid: list[dict[str, Any]] = []
        self.version = ""
        self.reload()

    def reload(self) -> None:
        recipes: dict[str, dict[str, Any]] = {}
        invalid = []
        for path in sorted(self.recipes_dir.glob("*.json")):
            try:
                recipe = json.loads(path.read_text(encoding="utf-8"))
                errors = self._validate(recipe)
                errors.extend(self.inventory.validate_recipe(recipe))
                if errors:
                    invalid.append({"file": path.name, "errors": errors})
                    continue
                if recipe["recipeId"] in recipes:
                    invalid.append({"file": path.name, "errors": [f"重复 recipeId: {recipe['recipeId']}"]})
                    continue
                recipes[recipe["recipeId"]] = recipe
            except (json.JSONDecodeError, OSError, KeyError, TypeError, ValueError) as exc:
                invalid.append({"file": path.name, "errors": [str(exc)]})
        self.recipes = recipes
        self.invalid = invalid
        canonical = json.dumps(list(recipes.values()), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        self.version = "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    @staticmethod
    def _validate(recipe: dict[str, Any]) -> list[str]:
        required = ["recipeId", "skuCode", "version", "name", "steps"]
        errors = [f"缺少字段 {field}" for field in required if field not in recipe]
        if not isinstance(recipe.get("steps"), list) or not recipe.get("steps"):
            errors.append("steps 必须是非空数组")
        visual_profile = recipe.get("visual", {}).get("profile")
        if visual_profile and visual_profile not in VISUAL_PROFILES:
            errors.append(f"不支持的 visual.profile: {visual_profile}")
        if "priceMinor" in recipe and (not isinstance(recipe["priceMinor"], int) or recipe["priceMinor"] <= 0):
            errors.append("priceMinor 必须是正整数（最小货币单位）")
        for step in recipe.get("steps", []):
            if not all(key in step for key in ["id", "name", "durationSeconds"]):
                errors.append("步骤必须包含 id、name、durationSeconds")
            elif float(step["durationSeconds"]) <= 0:
                errors.append(f"步骤 {step.get('id')} 时长必须大于 0")
            if step.get("animationCue") and step["animationCue"] not in ANIMATION_CUES:
                errors.append(f"步骤 {step.get('id')} 使用了不支持的 animationCue: {step['animationCue']}")
            randomization = step.get("durationRandomization")
            if randomization is not None:
                if not isinstance(randomization, dict) or "minSeconds" not in randomization or "maxSeconds" not in randomization:
                    errors.append(f"步骤 {step.get('id')} 的 durationRandomization 必须包含 minSeconds 和 maxSeconds")
                    continue
                try:
                    minimum = float(randomization["minSeconds"])
                    maximum = float(randomization["maxSeconds"])
                    baseline = float(step["durationSeconds"])
                    if minimum <= 0 or maximum < minimum:
                        errors.append(f"步骤 {step.get('id')} 的随机时长范围无效")
                    elif not minimum <= baseline <= maximum:
                        errors.append(f"步骤 {step.get('id')} 的 durationSeconds 必须位于随机范围内")
                except (TypeError, ValueError):
                    errors.append(f"步骤 {step.get('id')} 的随机时长必须是数字")
        return errors

    @staticmethod
    def duration_bounds(step: dict[str, Any]) -> tuple[float, float, float]:
        baseline = float(step["durationSeconds"])
        randomization = step.get("durationRandomization") or {}
        return float(randomization.get("minSeconds", baseline)), baseline, float(randomization.get("maxSeconds", baseline))

    @classmethod
    def materialize_execution_recipe(cls, recipe: dict[str, Any]) -> dict[str, Any]:
        """Freeze one randomized execution plan so progress never changes mid-task."""
        execution = deepcopy(recipe)
        for step in execution["steps"]:
            minimum, baseline, maximum = cls.duration_bounds(step)
            step["configuredDurationSeconds"] = baseline
            step["durationSeconds"] = round(random.uniform(minimum, maximum), 2)
        return execution

    def list(self) -> list[dict[str, Any]]:
        return list(self.recipes.values())

    def get(self, recipe_id: str) -> dict[str, Any] | None:
        return self.recipes.get(recipe_id)

    def capabilities(self, device_id: str, store_id: str) -> dict[str, Any]:
        products = []
        for recipe in sorted(self.recipes.values(), key=lambda item: item.get("display", {}).get("sortOrder", 100)):
            max_servings = self.inventory.max_servings(recipe)
            reasons = []
            if not recipe.get("enabled", True):
                reasons.append("DISABLED")
            if max_servings <= 0:
                reasons.append("MATERIAL_INSUFFICIENT")
            duration_bounds = [self.duration_bounds(step) for step in recipe["steps"]]
            products.append({
                "recipeId": recipe["recipeId"],
                "skuCode": recipe["skuCode"],
                "version": recipe["version"],
                "name": recipe["name"],
                "priceMinor": recipe.get("priceMinor"),
                "display": recipe.get("display", {}),
                "visual": recipe.get("visual", {"profile": "generic"}),
                "enabled": recipe.get("enabled", True),
                "available": not reasons,
                "maxServings": max_servings,
                "estimatedDurationSeconds": sum(item[1] for item in duration_bounds),
                "durationRangeSeconds": {"min": sum(item[0] for item in duration_bounds), "max": sum(item[2] for item in duration_bounds)},
                "unavailableReasons": reasons,
            })
        return {"deviceId": device_id, "storeId": store_id, "capabilityVersion": self.version, "products": products, "invalidRecipes": self.invalid}
