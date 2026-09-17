import copy
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "coffee-terminal"))
from inventory import InventoryError, InventoryManager


@pytest.fixture
def inventory(tmp_path):
    definitions = tmp_path / "materials.json"
    definitions.write_text(json.dumps({"materials": [
        {"materialId": name, "name": name, "unit": "ml", "capacity": 1000, "initialOnHand": 500, "lowThreshold": 10, "criticalThreshold": 1}
        for name in ("milk", "water")
    ]}))
    return InventoryManager(definitions, tmp_path / "state.json")


@pytest.mark.parametrize("mode,amount", [("SET", 0), ("ADD", -400), ("SET", float("nan")), ("ADD", float("inf"))])
def test_adjustment_preserves_reservation_and_file(inventory, mode, amount):
    inventory.reserve("task", {"milk": 180})
    before = copy.deepcopy(inventory.state)
    disk = inventory.state_path.read_bytes()
    with pytest.raises(InventoryError):
        inventory.adjust("milk", mode, amount)
    assert inventory.state == before
    assert inventory.state_path.read_bytes() == disk


def test_shortage_does_not_partially_consume_or_mark_completed(inventory):
    inventory.reserve("task", {"milk": 180, "water": 50})
    inventory.state["items"]["milk"]["onHand"] = 0
    before = copy.deepcopy(inventory.state)
    with pytest.raises(InventoryError):
        inventory.consume_step("task", "pour", [
            {"materialId": "water", "amount": 50, "unit": "ml"},
            {"materialId": "milk", "amount": 180, "unit": "ml"},
        ])
    assert inventory.state == before


def test_consumption_at_reserved_boundary_is_idempotent(inventory):
    inventory.reserve("task", {"milk": 180})
    inventory.adjust("milk", "SET", 180)
    dose = [{"materialId": "milk", "amount": 180, "unit": "ml"}]
    assert inventory.consume_step("task", "pour", dose)[0]["remaining"] == 0
    assert inventory.consume_step("task", "pour", dose) == []


def test_decimal_doses_do_not_trigger_false_shortage(inventory):
    inventory.reserve("task", {"milk": .6})
    inventory.adjust("milk", "SET", .6)
    for i, amount in enumerate((.4, .2)):
        inventory.consume_step("task", str(i), [{"materialId": "milk", "amount": amount, "unit": "ml"}])
    assert inventory.state["items"]["milk"]["onHand"] == 0
