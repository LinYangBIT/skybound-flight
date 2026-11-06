import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./dist/physics.js', import.meta.url), 'utf8');
const { createFlight, resetFlight, stepFlight } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
function simulate(state, input, seconds, fps = 60) {
  for (let i = 0; i < Math.round(seconds * fps); i++) stepFlight(state, input, 1 / fps);
  return state;
}
function airborne(changes = {}) { return Object.assign(createFlight({ airborne: true }), changes); }

test('airborne jet starts at 864 km/h with gear retracted', () => {
  const state = createFlight({ airborne: true });
  assert.equal(state.speed * 3.6, 864);
  assert.equal(state.y, 140);
  assert.equal(state.z, 2300);
  assert.equal(state.gear, false);
  assert.equal(state.boostEnergy, 100);
  assert.ok(state.mach > .69 && state.mach < .71);
});

test('parked aircraft stays stationary even if afterburner is requested', () => {
  const state = simulate(createFlight(), { throttle: 0, pitch: 1, boost: true }, 30);
  assert.equal(state.grounded, true);
  assert.equal(state.crashed, false);
  assert.equal(state.hasFlown, false);
  assert.equal(state.landed, false);
  assert.equal(state.y, 11.8);
  assert.equal(state.z, 650);
  assert.equal(state.speed, 0);
  assert.equal(state.boosting, false);
  assert.equal(state.boostEnergy, 100);
});

test('takeoff requires elevator and rotation speed; runway acceleration is brisk', () => {
  const state = simulate(createFlight(), { throttle: 1, pitch: 0 }, 3);
  assert.equal(state.grounded, true);
  assert.ok(state.speed > 75 && state.speed < 90);
  assert.ok(state.distance < 150);
  simulate(state, { throttle: 1, pitch: 0.55 }, 3);
  assert.equal(state.crashed, false);
  assert.equal(state.grounded, false);
  assert.ok(state.y > 25);
  assert.ok(state.z < 650);
});

test('neutral assistance levels the wings and returns to trim promptly', () => {
  const state = airborne({ roll: .7, pitch: .25 });
  simulate(state, { throttle: .82, assist: true }, 5);
  assert.ok(Math.abs(state.roll) < .001);
  assert.ok(Math.abs(state.pitch - .035) < .001);
  assert.ok(state.heading > 0);
  assert.equal(state.crashed, false);
});

test('cruise and dry maximum speeds are materially faster than the old propeller model', () => {
  const cruise = simulate(airborne(), { throttle: .82, gear: false }, 60);
  const full = simulate(airborne(), { throttle: 1, gear: false }, 60);
  assert.ok(cruise.speed > 235 && cruise.speed < 245);
  assert.ok(full.speed > 295 && full.speed < 305);
  assert.ok(cruise.distance > 14000);
});

test('afterburner provides a fast burst and has a hard speed limit', () => {
  const state = simulate(airborne(), { throttle: 1, boost: true }, 4);
  assert.ok(state.speed > 410 && state.speed <= 430);
  assert.ok(state.mach > 1.19);
  assert.ok(Math.abs(state.boostEnergy - 20) < .001);
  assert.equal(state.boosting, true);
  simulate(state, { throttle: 1, boost: true }, .9);
  assert.ok(state.speed <= 430);
});

test('exhausted boost does not flicker on while held, and release rearms it', () => {
  const state = simulate(airborne(), { throttle: 1, boost: true }, 9);
  assert.equal(state.boosting, false);
  assert.equal(state.boostLocked, true);
  assert.ok(state.boostEnergy > 35);
  const recovered = state.boostEnergy;
  simulate(state, { throttle: 1, boost: true }, 1);
  assert.equal(state.boosting, false);
  assert.ok(state.boostEnergy > recovered);
  stepFlight(state, { throttle: 1, boost: false });
  stepFlight(state, { throttle: 1, boost: true });
  assert.equal(state.boosting, true);
  assert.equal(state.boostLocked, false);
});

test('airbrake reaches approach speed within ten seconds and suppresses boost', () => {
  const state = simulate(airborne(), { throttle: 0, airbrake: true, boost: true }, 6);
  assert.ok(state.speed < 80);
  assert.ok(state.speed > 45, 'six-second braking run should not yet stall');
  assert.equal(state.boosting, false);
  assert.equal(state.crashed, false);
});

test('full bank produces a responsive, bounded multi-G turn', () => {
  const state = simulate(airborne({ y: 1000 }), { throttle: .82, roll: 1 }, 5);
  assert.ok(state.roll > 1.18 && state.roll <= 1.2);
  assert.ok(state.heading > .6 && state.heading < 1);
  assert.ok(state.gForce > 3 && state.gForce < 6);
  assert.equal(state.crashed, false);
});

test('climbing costs speed and low airspeed produces a genuine stall', () => {
  const level = simulate(airborne({ y: 1000 }), { throttle: .82 }, 4);
  const climb = simulate(airborne({ y: 1000 }), { throttle: .82, pitch: .6 }, 4);
  assert.ok(climb.speed < level.speed - 5);
  assert.ok(climb.y > level.y + 150);
  const state = airborne({ speed: 31, y: 500 });
  simulate(state, { throttle: 0, pitch: 1 }, 3);
  assert.equal(state.stall, true);
  assert.ok(state.verticalSpeed < -5);
  assert.ok(state.y < 480);
});

function touchdown(changes = {}, controls = {}) {
  const state = airborne({ x: 0, z: 0, y: 11.81, speed: 72, pitch: 0, verticalSpeed: -2, ...changes });
  stepFlight(state, { throttle: .1, gear: true, ...controls }, 1 / 60);
  return state;
}

test('a gentle aligned landing records touchdown and brakes to a stop', () => {
  const state = touchdown();
  assert.equal(state.crashed, false);
  assert.equal(state.grounded, true);
  assert.equal(state.landed, true);
  assert.ok(state.landingRate < 0 && state.landingRate > -5);
  simulate(state, { throttle: 0, brake: true }, 5);
  assert.equal(state.speed, 0);
  assert.equal(state.crashed, false);
});

test('the runway permits approaches in both directions', () => {
  const state = touchdown({ heading: Math.PI });
  assert.equal(state.landed, true);
  assert.equal(state.crashed, false);
});

test('unsafe touchdown configurations crash with useful reasons and freeze', () => {
  for (const [changes, controls, reason] of [
    [{}, { gear: false }, '起落架'],
    [{ verticalSpeed: -7 }, {}, '下降'],
    [{ roll: .5 }, {}, '倾斜'],
    [{ heading: Math.PI / 2 }, {}, '对准'],
    [{ speed: 105 }, {}, '速度'],
    [{ x: 60, y: 9.99 }, {}, '跑道'],
  ]) {
    const state = touchdown(changes, controls);
    assert.equal(state.crashed, true, reason);
    assert.ok(state.crashReason.includes(reason));
    const snapshot = structuredClone(state);
    simulate(state, { throttle: 1, pitch: 1, boost: true }, 2);
    assert.deepEqual(state, snapshot);
  }
});

test('taxiing is safe on the runway, but a moving runway excursion crashes', () => {
  const state = simulate(createFlight(), { throttle: .2 }, 3);
  assert.equal(state.crashed, false);
  assert.equal(state.landed, false);
  Object.assign(state, { x: 44.99, heading: Math.PI / 2 });
  simulate(state, { throttle: .2 }, 1);
  assert.equal(state.crashed, true);
});

test('reset preserves identity and clears all boost and flight history', () => {
  const state = touchdown({ verticalSpeed: -8 });
  state.boostLocked = true; state.boostEnergy = 0;
  assert.equal(resetFlight(state), state);
  assert.deepEqual(state, createFlight());
  resetFlight(state, { airborne: true });
  assert.deepEqual(state, createFlight({ airborne: true }));
});

test('high-speed motion remains deterministic across normal and low frame rates', () => {
  const normal = simulate(airborne({ y: 1000 }), { throttle: 1, boost: true, roll: .3 }, 3, 60);
  const slow = simulate(airborne({ y: 1000 }), { throttle: 1, boost: true, roll: .3 }, 3, 10);
  for (const key of ['x', 'y', 'z', 'speed', 'heading', 'distance', 'boostEnergy']) assert.ok(Math.abs(normal[key] - slow[key]) < 1e-7, key);
  const previous = { x: normal.x, y: normal.y, z: normal.z };
  stepFlight(normal, { throttle: 1, boost: true }, .1);
  assert.ok(Math.hypot(normal.x - previous.x, normal.y - previous.y, normal.z - previous.z) <= 44);
});

test('frame gaps and hostile input values remain bounded and finite', () => {
  const state = airborne();
  stepFlight(state, { throttle: 99, pitch: Infinity, roll: -99, yaw: NaN }, 30);
  assert.ok(Math.abs(state.elapsed - .1) < 1e-8);
  assert.equal(state.throttle, 1);
  assert.ok(Object.values(state).filter(value => typeof value === 'number').every(Number.isFinite));
  const snapshot = structuredClone(state);
  stepFlight(state, {}, -1);
  assert.deepEqual(state, snapshot);
});
