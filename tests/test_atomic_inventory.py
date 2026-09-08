import json
import subprocess
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "coffee-terminal"))
from inventory import InventoryManager
from state_store import LocalStateStore


def test_legacy_inventory_import_is_not_replayed(tmp_path):
    definitions = tmp_path / "materials.json"
    definitions.write_text(json.dumps({"materials": [
        {"materialId": "cup", "unit": "count", "initialOnHand": 10}
    ]}))
    legacy = tmp_path / "inventory.json"
    legacy.write_text(json.dumps({"items": {"cup": {"unit": "count", "onHand": 3}}}))
    store = LocalStateStore(tmp_path / "state.db")
    try:
        inventory = InventoryManager(definitions, legacy, state_store=store)
        assert inventory.state["items"]["cup"]["onHand"] == 3
        legacy.write_text("{}")
        inventory.reload()
        assert inventory.state["items"]["cup"]["onHand"] == 3
    finally:
        store.close()


def test_process_exit_rolls_back_inventory_job_and_outbox(tmp_path):
    path = tmp_path / "state.db"
    store = LocalStateStore(path)
    store.set_meta("inventory_state", {"cups": 2})
    store.save_job({"taskId": "task-1", "state": "RUNNING", "stepIndex": 0})
    before = store.current_job()
    store.close()
    script = '''
import os, sys
from pathlib import Path
from state_store import LocalStateStore
store = LocalStateStore(Path(sys.argv[1]))
with store.transaction():
    store.set_meta("inventory_state", {"cups": 1})
    store.save_job({"taskId": "task-1", "state": "SUCCEEDED", "stepIndex": 1})
    store.enqueue_event({"eventId": "event-1", "type": "task.succeeded", "occurredAt": "2026-09-08T00:00:00Z", "payload": {}})
    os._exit(23)
'''
    import os
    result = subprocess.run([sys.executable, "-c", script, str(path)],
                            env={**os.environ, "PYTHONPATH": str(PROJECT / "coffee-terminal")})
    assert result.returncode == 23
    store = LocalStateStore(path)
    try:
        assert store.get_meta("inventory_state") == {"cups": 2}
        assert store.current_job() == before
        assert store.pending_events() == []
    finally:
        store.close()
