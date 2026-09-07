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
