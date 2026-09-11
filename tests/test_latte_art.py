import json
import sys
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import Mock
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'coffee-terminal'))
from catalog import RecipeCatalog
from customization import compile_recipe, variants
from robot_view import step_plan
from backend import CoffeeDeviceRuntime

class LatteArtTest(unittest.TestCase):
    def setUp(self):
        self.recipe=json.loads((ROOT/'config/instances/coffee-bot-003/recipes/latte.json').read_text())

    def test_catalogue_and_zero_milk_variants(self):
        self.assertEqual(RecipeCatalog._validate(self.recipe),[])
        standard=compile_recipe(self.recipe)
        no_milk=compile_recipe(self.recipe,{'milk':'NONE'})
        self.assertFalse(any(s.get('latteArt') for s in no_milk['steps']))
        self.assertEqual(sum(i['amount'] for s in standard['steps'] for i in s.get('consumes',[]) if i['materialId']=='milk'),180)
        self.assertNotEqual(standard['compiledRecipeDigest'],no_milk['compiledRecipeDigest'])
        self.assertEqual(variants(self.recipe)[1]['materialRequirements']['milk'],180)
        art=next(s for s in step_plan(standard,{}) if s['stepId']=='latte-art')
        self.assertEqual(art['visual']['actions'],['latte-art'])
        self.assertEqual(art['visual']['latteArt'],{'patternId':'spiral','patternVersion':'1.0.0'})

    def test_bad_pattern_timing_order_and_missing_dose(self):
        for mutate in [lambda r:r['steps'][3]['latteArt'].update(patternId='heart'),
                       lambda r:r['steps'][3].update(durationSeconds=2),
                       lambda r:r['steps'][3].update(consumes=[]),
                       lambda r:r['optionSchema'].update(temperature='ICED'),
                       lambda r:r['steps'].append(r['steps'].pop(3)),
                       lambda r:r['steps'][3].update(durationRandomization={'minSeconds':10,'maxSeconds':40})]:
            recipe=deepcopy(self.recipe);mutate(recipe)
            self.assertTrue(RecipeCatalog._validate(recipe))

    def test_latte_art_failure_never_retries_even_if_profile_allows(self):
        backend=object.__new__(CoffeeDeviceRuntime)
        backend.inventory=Mock();backend.runtime={};backend._progress_reports={}
        backend._persist_task=Mock();backend._emit=Mock();backend._inventory_changed=Mock();backend._task_ref=Mock(return_value={})
        task={'taskId':'art-fail','stepRetries':{}}
        backend._fail_task(task,self.recipe['steps'][3],{'retryable':True,'maxRetries':3,'message':'倾倒失败','errorCode':'POUR_FAILED'},False)
        self.assertEqual(task['state'],'FAILED');self.assertFalse(task['failure']['retryable'])


    def test_legacy_default_latte_executes_but_incomplete_custom_commands_reject(self):
        import tempfile, shutil
        for variant in ['legacy', 'modern', 'incomplete', 'tampered', 'wrong-version', 'changed-default-price']:
            with self.subTest(variant=variant), tempfile.TemporaryDirectory() as directory:
                instance=Path(directory)
                shutil.copytree(ROOT/'config/instances/coffee-bot-003/recipes',instance/'recipes')
                shutil.copy(ROOT/'config/instances/coffee-bot-003/materials.json',instance/'materials.json')
                (instance/'failures.json').write_text(json.dumps({'globalFailureRate':0,'profiles':{},'stepOverrides':{}}))
                r=deepcopy(self.recipe)
                if variant=='changed-default-price':
                    r['optionSchema']['options']['milk']['priceDeltaMinor']={'STANDARD':100}
                    (instance/'recipes/latte.json').write_text(json.dumps(r))
                runtime=CoffeeDeviceRuntime({'deviceId':'isolated-art','storeId':'test','backend':{'mode':'local'},'localApi':{'enabled':False}},instance)
                command={'messageId':'cloud-art-test','taskId':'test-art','recipeId':r['recipeId'],'recipeVersion':r['version']}
                if variant in ['modern','incomplete','tampered']:
                    command['customization']={'milk':'STANDARD'}
                if variant in ['modern','tampered']:
                    command['compiledRecipeDigest']=compile_recipe(r)['compiledRecipeDigest'] if variant=='modern' else 'tampered'
                if variant=='wrong-version':command['recipeVersion']='old-version'
                try:
                    with runtime.lock:
                        result=runtime._accept_task(command)
                        if variant in ['legacy','modern']:
                            self.assertTrue(result['ok'],result)
                            self.assertTrue(runtime._accept_task(command)['duplicate'])
                            for _ in range(10):runtime._execution_tick(120)
                            task=runtime.runtime['task']
                            self.assertEqual(task['state'],'SUCCEEDED')
                            self.assertTrue(any(s.get('latteArt') for s in task['recipe']['steps']))
                            self.assertEqual(task['executionContract'],'legacy-default' if variant=='legacy' else 'versioned')
                        else:
                            self.assertFalse(result['ok'])
                            self.assertIsNone(runtime.runtime.get('task'))
                            if variant!='wrong-version':self.assertIn('installedDigest',result['details'])
                finally:runtime.close()
