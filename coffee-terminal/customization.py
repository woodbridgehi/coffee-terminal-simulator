"""One terminal-side compiler; cloud uses its published immutable variant summaries."""
from copy import deepcopy
from decimal import Decimal, ROUND_HALF_UP
from hashlib import sha256
from itertools import product
import json

VALUES = {'sugar': {'NONE': 0, 'LIGHT': .25, 'LESS': .5, 'STANDARD': 1, 'EXTRA': 1.25},
          'ice': {'NONE': 0, 'STANDARD': 1}, 'milk': {'NONE': 0, 'STANDARD': 1}}


def digest(value):
    return 'sha256:' + sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def normalize(recipe, options=None):
    schema = recipe.get('optionSchema')
    if not schema:
        if options: raise ValueError('customization is not supported')
        return {}
    if not isinstance(options or {}, dict): raise ValueError('customization must be an object')
    allowed = schema['options']
    if set(options or {}) - set(allowed): raise ValueError('unsupported customization option')
    result = {}
    for key, rule in allowed.items():
        value = (options or {}).get(key, rule['default'])
        if value not in rule['values']: raise ValueError('unsupported customization value: ' + key)
        result[key] = value
    return result


def compile_recipe(recipe, options=None):
    result = deepcopy(recipe)
    choices = normalize(recipe, options)
    schema = recipe.get('optionSchema') or {}
    extra = 0
    for key, value in choices.items():
        extra += schema['options'][key].get('priceDeltaMinor', {}).get(value, 0)
    steps = []
    for step in result['steps']:
        key = step.get('customizationRole')
        if key:
            factor = VALUES[key][choices[key]]
            if not factor: continue  # no pump, motion, reservation or retry for zero dose
            for item in step['consumes']:
                item['amount'] = float((Decimal(str(item['amount'])) * Decimal(str(factor))).quantize(Decimal('.001'), rounding=ROUND_HALF_UP))
                if item['amount'] <= 0: raise ValueError('dose below supported precision')
            # Preserve mechanical minimum; only extra dose extends the time budget.
            scale = max(1, factor)
            step['durationSeconds'] = round(step['durationSeconds'] * scale, 3)
            if step.get('durationRandomization'):
                step['durationRandomization'] = {k: round(v * scale, 3) for k, v in step['durationRandomization'].items()}
        steps.append(step)
    result['liquidReferenceMl'] = sum(float(item['amount']) for step in recipe['steps'] for item in step.get('consumes', []) if item['unit'] == 'ml')
    result['steps'] = steps
    result['customization'] = choices
    result['optionSchemaVersion'] = schema.get('version')
    result['priceDeltaMinor'] = extra
    result['compiledRecipeDigest'] = digest(result)
    return result


def validate(recipe):
    schema = recipe.get('optionSchema')
    if not schema: return []
    try:
        if set(schema) != {'version', 'options', 'temperature', 'fillPolicy', 'notice'}: raise ValueError('invalid optionSchema fields')
        if not isinstance(schema['version'], str) or not schema['version']: raise ValueError('option schema version required')
        if schema['fillPolicy'] != 'NO_TOP_UP' or schema['temperature'] not in ('HOT', 'AMBIENT', 'ICED'): raise ValueError('unsupported temperature/fill policy')
        if not isinstance(schema['notice'], str): raise ValueError('notice must be text')
        if not schema['options'] or set(schema['options']) - set(VALUES): raise ValueError('unsupported option')
        for key, rule in schema['options'].items():
            if set(rule) - {'default', 'values', 'priceDeltaMinor'}: raise ValueError('unsupported rule')
            if not isinstance(rule['values'], list) or not rule['values'] or len(set(rule['values'])) != len(rule['values']) or set(rule['values']) - set(VALUES[key]): raise ValueError('invalid option values')
            if rule['default'] not in rule['values']: raise ValueError('invalid default')
            deltas = rule.get('priceDeltaMinor', {})
            if set(deltas) - set(rule['values']) or any(type(v) is not int or v < 0 for v in deltas.values()): raise ValueError('invalid price delta')
            targets = [s for s in recipe['steps'] if s.get('customizationRole') == key]
            if not targets: raise ValueError('option has no explicit dispensing step')
            for step in targets:
                if not step.get('consumes') or not step.get('dispenseChannel'): raise ValueError('custom step needs dose and channel')
                if len(step['consumes']) != 1: raise ValueError('custom step must have exactly one ingredient')
        for step in recipe['steps']:
            if step.get('customizationRole') and step['customizationRole'] not in schema['options']: raise ValueError('step option missing')
        for variant in variants(recipe):
            if not variant['materialRequirements']: raise ValueError('empty recipe')
    except (KeyError, TypeError, ValueError, ArithmeticError) as exc:
        return [f'optionSchema: {exc}']
    return []


def variants(recipe):
    schema = recipe.get('optionSchema')
    if not schema: return []
    keys = list(schema['options'])
    result = []
    for values in product(*(schema['options'][k]['values'] for k in keys)):
        compiled = compile_recipe(recipe, dict(zip(keys, values)))
        requirements = {}
        for step in compiled['steps']:
            for item in step.get('consumes', []):
                mid = item['materialId']; requirements[mid] = round(requirements.get(mid, 0) + item['amount'], 3)
        result.append({k: compiled[k] for k in ('customization', 'optionSchemaVersion', 'compiledRecipeDigest', 'priceDeltaMinor')} | {
            'materialRequirements': requirements,
            'estimatedDurationSeconds': sum(s['durationSeconds'] for s in compiled['steps']),
            'durationRangeSeconds': {bound: sum(s.get('durationRandomization', {}).get(field, s['durationSeconds']) for s in compiled['steps']) for bound, field in [('min', 'minSeconds'), ('max', 'maxSeconds')]},
        })
    return result
