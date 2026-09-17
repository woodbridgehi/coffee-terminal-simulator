"""Regression gates for durable intake, command effects and configuration changes."""
import json
import os
import subprocess
import sys
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

import pytest
import test_runtime
from backend import CoffeeDeviceRuntime
from state_store import LocalStateStore


@pytest.fixture
def case():
    case = test_runtime.RuntimeTest()
    case.setUp()
    case.runtime.stop_event.set()
    for thread in case.runtime.background_threads:
        thread.join(3)
        assert not thread.is_alive()
    try:
        yield case
    finally:
        case.tearDown()


def adjustment(**changes):
    return {"messageId": "add-once", "type": "INVENTORY_ADJUSTMENT",
            "payload": {"materialId": "beans", "mode": "ADD", "amount": 5}, **changes}


@pytest.mark.parametrize("boundary", ["before-result", "after-commit"])
def test_process_exit_preserves_exactly_one_inventory_effect(case, boundary):
    case.runtime.close()
    code = '''
import json, os, sys
from backend import CoffeeDeviceRuntime
from pathlib import Path
runtime = CoffeeDeviceRuntime(json.loads(sys.argv[1]), Path(sys.argv[2]))
runtime.stop_event.set()
for thread in runtime.background_threads: thread.join(3)
command = json.loads(sys.argv[3])
if sys.argv[4] == "before-result":
    runtime._complete_control_command = lambda *args: os._exit(71)
    runtime._process_commands([command])
else:
    runtime._process_commands([command])
    os._exit(72)
'''
    env = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "coffee-terminal")}
    result = subprocess.run([sys.executable, "-c", code, json.dumps(case.config), str(case.instance),
                             json.dumps(adjustment()), boundary], env=env, timeout=15)
    assert result.returncode == (71 if boundary == "before-result" else 72)
    store = LocalStateStore(case.instance / "state/runtime.db")
    assert store.get_meta("inventory_state")["items"]["beans"]["onHand"] == (40 if boundary == "before-result" else 45)
    store.close()
    case.runtime = CoffeeDeviceRuntime(case.config, case.instance)
    case.runtime.stop_event.set()
    for thread in case.runtime.background_threads: thread.join(3)
    case.runtime._process_commands([adjustment()])
    assert case.runtime.inventory.state["items"]["beans"]["onHand"] == 45
    assert case.runtime.store.command("add-once")["state"] == "APPLIED"


def test_storage_failure_rolls_back_inventory_and_keeps_retryable_inbox(case):
    runtime = case.runtime
    before = deepcopy(runtime.inventory.state)
    with patch.object(runtime.store, "complete_command", side_effect=OSError("disk failed")):
        with pytest.raises(OSError):
            runtime._process_commands([adjustment()])
    assert runtime.inventory.state == before
    assert runtime.store.get_meta("inventory_state") == before
    assert runtime.store.command("add-once")["state"] == "RECEIVED"
    runtime._process_commands([adjustment()])
    assert runtime.inventory.state["items"]["beans"]["onHand"] == 45


def test_expiration_and_completed_replay(case):
    runtime = case.runtime
    runtime._process_commands([adjustment(expiresAt="2000-01-01T00:00:00Z")])
    assert runtime.inventory.state["items"]["beans"]["onHand"] == 40
    assert runtime.store.command("add-once")["result"]["reasonCode"] == "COMMAND_EXPIRED"
    command = adjustment(messageId="already-applied", expiresAt="2099-01-01T00:00:00Z")
    runtime._process_commands([command])
    original = runtime.store.command("already-applied")["result"]
    # A duplicate never reaches expiry or execution checks.
    with patch.object(runtime, "_execute_received_command", side_effect=AssertionError("re-executed")):
        runtime._process_commands([command])
    assert runtime.store.command("already-applied")["result"] == original
    runtime._process_commands([adjustment(messageId="already-applied")])  # different content rejected
    assert runtime.inventory.state["items"]["beans"]["onHand"] == 45


@pytest.mark.parametrize("expiry", ["bad", "2026-09-17T00:00:00", 123])
def test_invalid_expiry_is_rejected(case, expiry):
    case.runtime._process_commands([adjustment(expiresAt=expiry)])
    assert case.runtime.store.command("add-once")["result"]["reasonCode"] == "INVALID_COMMAND"


def test_old_task_control_cannot_pause_new_task(case):
    runtime = case.runtime
    runtime.start_demo_order("coffee-v1")
    runtime._execution_tick(.001)
    for index, target in enumerate((None, "old-task")):
        runtime._process_commands([{"messageId": f"pause-{index}", "type": "DEBUG_COMMAND", "action": "pause", "taskId": target}])
        assert runtime.store.command(f"pause-{index}")["state"] == "REJECTED"
    assert runtime.runtime["task"]["state"] == "RUNNING"


def test_empty_release_and_skip_preserve_future_reservations(case):
    runtime = case.runtime
    recipe = json.loads((case.instance / "recipes/coffee.json").read_text())
    recipe["steps"][0]["consumes"] = []
    assert runtime.save_recipe(json.dumps(recipe))["ok"]
    runtime.start_demo_order("coffee-v1")
    runtime._execution_tick(.001)
    before = deepcopy(runtime.inventory.state)
    assert runtime._apply_command("skip")["ok"]
    assert runtime.inventory.state == before
    runtime._execution_tick(1)
    assert runtime.runtime["task"]["state"] == "SUCCEEDED"


@pytest.mark.parametrize("bad", ["invalid", -1, 1.1, float("nan")])
def test_bad_failure_policy_keeps_live_configuration(case, bad):
    old = case.runtime.failures
    path = case.instance / "failures.json"
    policy = json.loads(path.read_text()); policy["globalFailureRate"] = bad
    path.write_text(json.dumps(policy))
    assert not case.runtime.reload_config()["ok"]
    assert case.runtime.failures is old


def test_nonfinite_recipe_is_not_written(case):
    path = case.instance / "recipes/coffee.json"
    before = path.read_bytes()
    recipe = json.loads(before); recipe["steps"][1]["consumes"][0]["amount"] = float("nan")
    assert not case.runtime.save_recipe(json.dumps(recipe))["ok"]
    assert path.read_bytes() == before


def test_configuration_commit_failure_restores_objects_and_disk(case):
    runtime = case.runtime
    original = runtime.inventory, runtime.catalog, runtime.failures
    before = runtime.store.get_meta("inventory_state")
    recipe = json.loads((case.instance / "recipes/coffee.json").read_text()); recipe["name"] = "new"
    case.write_json("recipes/coffee.json", recipe)
    with patch.object(runtime, "_emit", side_effect=OSError("commit interrupted")):
        assert not runtime.reload_config()["ok"]
    assert (runtime.inventory, runtime.catalog, runtime.failures) == original
    assert runtime.store.get_meta("inventory_state") == before
    assert runtime.reload_config()["ok"]
    assert runtime.catalog.get("coffee-v1")["name"] == "new"


def test_offline_simulation_continues_accepted_production(case):
    runtime = case.runtime
    runtime.start_demo_order("coffee-v1"); runtime._execution_tick(.001)
    runtime._apply_command("toggle-offline")
    runtime._execution_tick(.01)
    assert runtime.runtime["task"]["stepElapsed"] == .011
    assert runtime.runtime["connection"] == "OFFLINE"
    runtime._apply_command("pause")
    runtime._execution_tick(.01)
    assert runtime.runtime["task"]["stepElapsed"] == .011


def test_restart_replays_received_make_but_preserves_started_recovery_hold(case):
    command = {"messageId": "pending-make", "type": "MAKE_DRINK", "taskId": "received-task", "recipeId": "coffee-v1"}
    case.runtime.store.record_command(command)
    case.runtime.close()
    # No real transports: remote recovery semantics with the cloud loop stubbed.
    remote_config = {**case.config, "backend": {"mode": "remote", "baseUrl": "http://127.0.0.1:1"}}
    with patch.object(CoffeeDeviceRuntime, "_cloud_loop", lambda self: None), patch.object(CoffeeDeviceRuntime, "_execution_loop", lambda self: None):
        case.runtime = CoffeeDeviceRuntime(remote_config, case.instance)
        assert case.runtime.runtime["task"]["taskId"] == "received-task"
        assert not case.runtime.runtime["task"].get("recoveryHold")
        case.runtime._execution_tick(.001)
        before = deepcopy(case.runtime.inventory.state)
        case.runtime.close()
        case.runtime = CoffeeDeviceRuntime(remote_config, case.instance)
        assert case.runtime.runtime["task"]["recoveryHold"]
        assert case.runtime.runtime["task"]["state"] == "PAUSED"
        case.runtime._process_commands([command])
        case.runtime._execution_tick(100)
        assert case.runtime.inventory.state["items"] == before["items"]
        assert case.runtime.runtime["task"]["state"] == "PAUSED"
        assert case.runtime.store.command("pending-make")["deliveryState"] == "PENDING"


def test_config_response_failure_also_rolls_back_swap(case):
    runtime = case.runtime
    before = runtime.inventory, runtime.catalog, runtime.failures
    with patch.object(runtime, "capabilities", side_effect=ValueError("invalid response")):
        assert not runtime.reload_config()["ok"]
    assert (runtime.inventory, runtime.catalog, runtime.failures) == before


@pytest.mark.parametrize("command", [
    {"type": "INVENTORY_ADJUSTMENT", "payload": None},
    {"type": "DEBUG_COMMAND", "action": []},
    {"type": "INVENTORY_ADJUSTMENT", "payload": {"materialId": "beans", "mode": None, "amount": 1}},
])
def test_malformed_control_does_not_block_following_command(case, command):
    case.runtime._process_commands([{**command, "messageId": "malformed"}, adjustment()])
    assert case.runtime.store.command("malformed")["state"] == "REJECTED"
    assert case.runtime.inventory.state["items"]["beans"]["onHand"] == 45
