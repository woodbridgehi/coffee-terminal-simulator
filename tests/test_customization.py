import json
import sys
import unittest
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'coffee-terminal'))
from customization import compile_recipe, variants, validate
from robot_view import step_plan

class CustomizationTest(unittest.TestCase):
    def setUp(self):
        self.recipe = json.loads((ROOT / 'config/instances/coffee-bot-003/recipes/iced-vanilla-latte.json').read_text())

    def test_all_twenty_combinations_and_zero_dose_execution(self):
        combinations = variants(self.recipe)
        self.assertEqual(len(combinations), 20)
        self.assertEqual(len({v['compiledRecipeDigest'] for v in combinations}), 20)
        for variant in combinations:
            recipe = compile_recipe(self.recipe, variant['customization'])
            self.assertEqual(recipe['compiledRecipeDigest'], variant['compiledRecipeDigest'])
            ids = [s['id'] for s in recipe['steps']]
            self.assertEqual([s['stepId'] for s in step_plan(recipe, {})], ids)
            for key, mid, step_id in [('milk', 'milk', 'add-milk'), ('ice', 'ice', 'add-ice'), ('sugar', 'vanilla-syrup', 'add-vanilla')]:
                self.assertEqual(mid in variant['materialRequirements'], variant['customization'][key] != 'NONE')
                self.assertEqual(step_id in ids, variant['customization'][key] != 'NONE')
        self.assertEqual(compile_recipe(self.recipe, {'sugar':'EXTRA'})['steps'][3]['consumes'][0]['amount'], 25)
        self.assertEqual(validate(self.recipe), [])

    def test_rule_validation_and_immutable_input(self):
        original = deepcopy(self.recipe)
        for options in [{'sugar':'INVALID'}, {'temperature':'HOT'}]:
            with self.assertRaises(ValueError): compile_recipe(self.recipe, options)
        compile_recipe(self.recipe, {'milk':'NONE'})
        self.assertEqual(self.recipe, original)
        self.recipe['steps'][3].pop('dispenseChannel')
        self.assertTrue(validate(self.recipe))

    def test_price_and_duration_change_with_rules_and_digest_changes(self):
        before = compile_recipe(self.recipe, {'sugar':'EXTRA'})
        self.recipe['optionSchema']['options']['sugar']['priceDeltaMinor']['EXTRA'] = 100
        after = compile_recipe(self.recipe, {'sugar':'EXTRA'})
        self.assertNotEqual(before['compiledRecipeDigest'], after['compiledRecipeDigest'])
        self.assertEqual(after['priceDeltaMinor'], 100)
        self.assertGreater(after['steps'][3]['durationSeconds'], self.recipe['steps'][3]['durationSeconds'])

    def test_runtime_digest_reservation_duplicate_and_restart(self):
        import tempfile, shutil
        from backend import CoffeeDeviceRuntime
        with tempfile.TemporaryDirectory() as directory:
            instance = Path(directory)
            source = ROOT / 'config/instances/coffee-bot-003'
            shutil.copytree(source / 'recipes', instance / 'recipes')
            for name in ('materials.json', 'failures.json'):
                shutil.copy(source / name, instance / name)
            config = {'deviceId':'custom-test', 'deviceName':'Test', 'storeId':'test', 'backend':{'mode':'local'}, 'localApi':{'enabled':False}}
            runtime = CoffeeDeviceRuntime(config, instance)
            choices = {'sugar':'NONE','ice':'NONE','milk':'NONE'}
            compiled = compile_recipe(self.recipe, choices)
            command = {'messageId':'custom-cmd','taskId':'custom-task','orderId':'custom-order','recipeId':self.recipe['recipeId'], 'recipeVersion':self.recipe['version'], 'customization':choices,'compiledRecipeDigest':compiled['compiledRecipeDigest']}
            try:
                with runtime.lock:
                    invalid = dict(command,compiledRecipeDigest='tampered')
                    self.assertFalse(runtime._accept_task(invalid)['ok'])
                    # Rejections have their own task inbox; use a distinct task for valid execution.
                    command['taskId'] = 'valid-custom-task'
                    self.assertTrue(runtime._accept_task(command)['ok'])
                    frozen = deepcopy(runtime.runtime['task']['recipe'])
                    self.assertNotIn('add-milk', [s['id'] for s in frozen['steps']])
                    self.assertEqual(runtime.inventory.state['items']['milk']['reserved'], 0)
                    self.assertTrue(runtime._accept_task(command)['duplicate'])
                    conflict = dict(command,customization={'sugar':'EXTRA'})
                    self.assertFalse(runtime._accept_task(conflict)['ok'])
                    task = runtime.runtime['task']
                    task.update(state='RETRY_WAIT', failure={'stepId':task['recipe']['steps'][0]['id'],'retryable':True,'maxRetries':1})
                    self.assertTrue(runtime.command('retry')['ok'])
                    self.assertEqual(task['attempt'],2)
                    self.assertEqual(task['recipe'],frozen)
                    self.assertEqual(runtime.inventory.state['items']['milk']['reserved'],0)
            finally: runtime.close()
            recovered = CoffeeDeviceRuntime(config,instance)
            try:
                self.assertEqual(recovered.runtime['task']['recipe'], frozen)
                self.assertEqual(recovered.runtime['task']['requestedCustomization'],choices)
            finally: recovered.close()
