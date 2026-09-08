import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "coffee-terminal"))
from catalog import RecipeCatalog
from inventory import InventoryManager


def test_duplicate_step_never_enters_catalog(tmp_path):
    root = Path(__file__).resolve().parents[1] / "config/instances/coffee-bot-001"
    recipe = json.loads((root / "recipes/americano.json").read_text())
    recipe["steps"][1]["id"] = recipe["steps"][0]["id"]
    (tmp_path / "recipes").mkdir()
    (tmp_path / "recipes/bad.json").write_text(json.dumps(recipe))
    inv = InventoryManager(root / "materials.json", tmp_path / "inventory.json")
    catalog = RecipeCatalog(tmp_path / "recipes", inv)
    assert catalog.list() == []
    assert any("重复 stepId" in error for error in catalog.invalid[0]["errors"])
