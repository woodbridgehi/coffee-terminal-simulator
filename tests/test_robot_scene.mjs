import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createArm } from '../coffee-terminal/web/robot/models.mjs';
import { BASES, LIMITS, deg, solveUpright } from '../coffee-terminal/web/robot/kinematics.mjs';
import { createSequence, sampleSequence, RECIPES, STATIONS } from '../coffee-terminal/web/robot/sequence.mjs';

const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

for (const recipe of Object.keys(RECIPES)) {
  test(`${recipe}: every rendered TCP reaches its path with the expected grasp orientation and joint limits`, () => {
    const sequence = createSequence(recipe);
    const arms = { left: createArm('left'), right: createArm('right') };
    const position = new THREE.Vector3(), direction = new THREE.Vector3(), rotation = new THREE.Quaternion();
    for (let time = 0; time <= sequence.duration; time += 0.1) {
      const state = sampleSequence(sequence, time);
      for (const side of ['left', 'right']) {
        const arm = arms[side]; arm.move(state[side]);
        arm.tcp.getWorldPosition(position);
        position.toArray().forEach((value, i) => close(value, state[side][i]));
        arm.tcp.getWorldQuaternion(rotation);
        direction.set(0, 1, 0).applyQuaternion(rotation);
        {
          close(direction.y,0);
          direction.set(0,0,1).applyQuaternion(rotation);close(direction.y,1);
        }
        arm.angles.forEach((q, i) => assert.ok(deg(q) >= LIMITS[i][0] && deg(q) <= LIMITS[i][1]));
      }
    }
  });

  test(`${recipe}: cup ownership transfers on a fixture without teleporting or changing liquid`, () => {
    const sequence = createSequence(recipe);
    for (const segment of sequence.segments.slice(0, -1)) {
      const before = sampleSequence(sequence, segment.end - 1e-7);
      const after = sampleSequence(sequence, segment.end + 1e-7);
      before.cup.forEach((value, i) => close(value, after.cup[i], 1e-5));
      close(before.fill, after.fill, 1e-5);
      if (before.owner !== after.owner) {
        assert.ok(before.owner === null || after.owner === null, 'no direct two-arm handover');
      }
    }
    const final = sampleSequence(sequence, sequence.duration);
    assert.equal(final.done, true); assert.equal(final.owner, null); assert.equal(final.lid, true);
    assert.deepEqual(final.cup, STATIONS.pickup.position); assert.ok(final.fill > 0.8);
  });
}

test('seeking is stateless: reset after a finished or milk-filled cup returns an empty uncapped cup', () => {
  const sequence = createSequence();
  const initial = sampleSequence(sequence, 0);
  sampleSequence(sequence, sequence.duration);
  sampleSequence(sequence, 30);
  assert.deepEqual(sampleSequence(sequence, 0), initial);
  assert.equal(initial.fill, 0); assert.equal(initial.lid, false); assert.equal(initial.owner, null);
});

test('recipes visit only their required ingredients and perform left-to-fixture-to-right handoff', () => {
  for (const id of Object.keys(RECIPES)) {
    const sequence = createSequence(id);
    const streams = [...new Set(sequence.segments.map((s) => s.stream).filter(Boolean))];
    assert.deepEqual(streams, id === 'americano' ? ['coffee', 'water'] : id === 'vanilla' ? ['coffee', 'milk', 'syrup'] : ['coffee', 'milk']);
    const rightPickup = sequence.segments.find((s) => s.to.owner === 'right');
    assert.deepEqual(rightPickup.to.left, sampleSequence(sequence, 0).left, 'left arm must clear the shared zone first');
  }
});

test('invalid or out-of-reach targets fail explicitly', () => {
  assert.throws(() => solveUpright([20, 1, 0], BASES.left), RangeError);
  assert.throws(() => solveUpright([NaN, 1, 0], BASES.left), RangeError);
  assert.throws(() => createSequence('unknown'), RangeError);
});
