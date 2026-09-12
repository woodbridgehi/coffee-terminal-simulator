import json
import shutil
import sys
import zipfile
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'coffee-terminal'))
from backend import CoffeeDeviceRuntime
from catalog import RecipeCatalog
from cloud import CloudError
from latte_art import validate as validate_art
from customization import compile_recipe, variants

ROOT = Path(__file__).resolve().parents[1]


def runtime(tmp_path):
    source = ROOT / 'config/instances/coffee-bot-003'
    for name in ('materials.json', 'failures.json'):
        shutil.copy(source / name, tmp_path / name)
    for name in ('recipes', 'recipe-archive'):
        shutil.copytree(source / name, tmp_path / name)
    value = CoffeeDeviceRuntime({'deviceId': 'qa-only', 'instanceId': 'qa-only', 'backend': {'mode': 'local'}, 'localApi': {'enabled': False}}, tmp_path)
    value.failures.should_fail = lambda *args: (False, {})
    value.stop_event.set()
    value.background_threads[0].join(timeout=2)
    return value


def test_beijing_defaults_complete_and_none_milk_removes_art(tmp_path):
    r = runtime(tmp_path)
    try:
        assert not r.catalog.invalid and len(r.catalog.list()) == 10
        art = [x for x in r.catalog.list() if any('latte-art' in s.get('robotActions', []) for s in x['steps'])]
        assert len(art) == 4
        for recipe in r.catalog.list():
            for v in variants(recipe):
                compiled = compile_recipe(recipe, v['customization'])
                assert not validate_art(compiled)
                if v['customization'].get('milk') == 'NONE':
                    assert all('latte-art' not in s.get('robotActions', []) for s in compiled['steps'])
            task_id = 'qa-' + recipe['recipeId']
            result = r._accept_task({'messageId': 'local-' + task_id, 'taskId': task_id, 'recipeId': recipe['recipeId'], 'orderId': task_id})
            assert result['ok'], result
            for _ in range(12):
                if r.runtime['task']['state'] == 'SUCCEEDED': break
                r._execution_tick(100)
            assert r.runtime['task']['state'] == 'SUCCEEDED'
            assert r.confirm_pickup(task_id)['ok']
    finally:
        r.close()


def test_old_order_resolves_archived_version_but_unknown_version_rejected(tmp_path):
    r = runtime(tmp_path)
    try:
        old = r.catalog.historical('bj-latte-v1', '2.1.0')
        compiled = compile_recipe(old, {})
        result = r._accept_task({'messageId': 'cloud-old', 'taskId': 'old-task', 'recipeId': old['recipeId'], 'recipeVersion': old['version'], 'compiledRecipeDigest': compiled['compiledRecipeDigest'], 'customization': compiled['customization']})
        assert result['ok'], result
        assert r.runtime['task']['recipe']['version'] == '2.1.0'
        assert r.catalog.historical('bj-latte-v1', '../../device') is None
        assert r.catalog.historical('bj-latte-v1', '0.0.0') is None
    finally:
        r.close()


def test_sync_receipt_failure_retry_and_full_recipe_snapshot(tmp_path):
    r = runtime(tmp_path)
    try:
        assert r.request_menu_sync()['reasonCode'] == 'LOCAL_MODE'
        r.cloud = Mock(timeout=0)
        r.cloud.sync_capabilities.side_effect = CloudError('test offline')
        assert r.request_menu_sync()['queued']
        try: r._sync_snapshots()
        except CloudError: pass
        assert r.menu_sync['status'] == 'FAILED'
        r.cloud.sync_capabilities.side_effect = None
        r.cloud.sync_capabilities.return_value = {'ok': True, 'receivedAt': '2026-09-12T00:00:00Z'}
        r.cloud.sync_inventory.return_value = {'ok': True}
        r._sync_snapshots()
        assert r.menu_sync['status'] == 'SYNCED'
        sent = r.cloud.sync_capabilities.call_args.args[0]
        assert len(sent['products']) == len(sent['recipes']) == 10
        assert all(x['steps'] for x in sent['recipes'])
        assert sent['capabilityVersion'] == r.menu_sync['syncedVersion']
        r.runtime['task'] = {'state': 'PAUSED', 'recoveryHold': True}
        assert not r.request_menu_sync()['ok']
    finally:
        r.runtime['task'] = None
        r.close()


def test_export_contains_content_recipes_but_no_credentials_or_live_state(tmp_path):
    r = runtime(tmp_path)
    try:
        r.config['backend']['authToken'] = 'secret-never-export'
        r.config['deviceName'] = 'local-device-name'
        result = r.export_operations_bundle()
        assert result['ok'] and result['recipeCount'] == 10
        with zipfile.ZipFile(result['path']) as z:
            names = z.namelist()
            assert 'showcase.zip' in names and 'materials.json' in names
            assert len([n for n in names if n.startswith('recipes/')]) == 10
            assert not any('device.json' in n or 'state/' in n for n in names)
            assert not any(b'secret-never-export' in z.read(n) for n in names)
    finally:
        r.close()


def test_saved_revision_archives_previous_recipe(tmp_path):
    r = runtime(tmp_path)
    try:
        old = json.loads(json.dumps(r.catalog.get('bj-latte-v1')))
        changed = json.loads(json.dumps(old))
        changed['steps'][0]['durationSeconds'] += 1
        result = r.save_recipe(json.dumps(changed))
        assert result['ok'], result
        assert result['recipeVersion'] == '3.0.1'
        assert r.catalog.historical(old['recipeId'], '3.0.0') == old
    finally:
        r.close()
