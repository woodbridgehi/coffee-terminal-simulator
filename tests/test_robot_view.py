import copy
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "coffee-terminal"))
from robot_view import step_plan


def test_plan_uses_real_ingredients_without_mutating_recipe_or_exposing_stock():
    recipe = {"steps": [{"id":"brew", "name":"萃取", "durationSeconds":7.23,
                          "consumes":[{"materialId":"coffee-beans","amount":18,"unit":"g"},
                                      {"materialId":"water","amount":45,"unit":"ml"}]}]}
    original = copy.deepcopy(recipe)
    result = step_plan(recipe, {"coffee-beans":{"name":"门店咖啡豆","onHand":123,"cost":9}})
    assert recipe == original
    assert result[0]["durationSeconds"] == 7.23
    assert result[0]["visual"]["actions"] == ["brew"]  # extraction water is not an extra hot-water step
    assert result[0]["visual"]["materials"][0] == {"materialId":"coffee-beans","name":"门店咖啡豆","amount":18,"unit":"g"}


def test_all_installed_recipes_have_complete_visual_plans():
    for path in (ROOT / "config" / "instances").glob("*/recipes/*.json"):
        recipe = json.loads(path.read_text())
        definitions = json.loads((path.parent.parent / "materials.json").read_text())
        plan = step_plan(recipe, {m["materialId"]:m for m in definitions["materials"]})
        assert len(plan) == len(recipe["steps"])
        assert sum(s["durationSeconds"] for s in plan) == sum(s["durationSeconds"] for s in recipe["steps"])
        if any(m["materialId"] == "ice" for s in recipe["steps"] for m in s.get("consumes",[])):
            assert any("ice" in s["visual"]["actions"] for s in plan)


def test_custom_actions_are_explicit_and_unknown_steps_wait():
    recipe={"steps":[{"id":"special","name":"Custom","durationSeconds":3,"robotActions":["syrup","milk"]},
                     {"id":"calibrate","name":"校准","durationSeconds":2}]}
    assert [s["visual"]["actions"] for s in step_plan(recipe,{})] == [["syrup","milk"],["wait"]]


def test_primary_demo_catalogs_keep_readable_pacing_and_valid_materials():
    expected_recipe_counts = {
        "coffee-bot-001": 5,
        "coffee-bot-002": 3,
        "coffee-bot-003": 10,
    }
    for instance_id, expected_count in expected_recipe_counts.items():
        instance_dir = ROOT / "config" / "instances" / instance_id
        materials = {
            item["materialId"]: item
            for item in json.loads((instance_dir / "materials.json").read_text())["materials"]
        }
        recipes = [json.loads(path.read_text()) for path in (instance_dir / "recipes").glob("*.json")]
        assert len(recipes) == expected_count
        assert len({recipe["recipeId"] for recipe in recipes}) == expected_count

        for recipe in recipes:
            assert len(recipe["steps"]) >= 3
            assert sum(float(step["durationSeconds"]) for step in recipe["steps"]) >= 42
            plan = step_plan(recipe, materials)
            assert plan[0]["visual"]["actions"] == ["cups"]
            assert "pickup" in plan[-1]["visual"]["actions"]
            for step in recipe["steps"]:
                assert float(step["durationSeconds"]) >= 8
                randomization = step.get("durationRandomization", {})
                assert float(randomization.get("minSeconds", step["durationSeconds"])) >= 7
                for consumption in step.get("consumes", []):
                    definition = materials[consumption["materialId"]]
                    assert consumption["unit"] == definition["unit"]
