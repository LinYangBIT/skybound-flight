/** Approachable high-performance jet model. Metres, seconds and radians. */
const TAU = Math.PI * 2;
const REST_HEIGHT = 11.8;
const MAX_ALTITUDE = 12500;
const MAX_SPEED = 430;
const TRIM_PITCH = 0.035;
const GRAVITY = 9.81;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
const wrap = angle => ((angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
const runwayAt = (x, z) => Math.abs(x) <= 45 && Math.abs(z) <= 900;

export function createFlight({ airborne = false } = {}) {
  return {
    x: 0, y: airborne ? 140 : REST_HEIGHT, z: airborne ? 2300 : 650,
    heading: 0, pitch: airborne ? TRIM_PITCH : 0, roll: 0,
    speed: airborne ? 240 : 0, verticalSpeed: 0,
    throttle: airborne ? 0.82 : 0,
    grounded: !airborne, crashed: false, crashReason: '', landed: false,
    stall: false, elapsed: 0, distance: 0, landingRate: 0, fuel: 100,
    gear: !airborne, flaps: false, assist: true, hasFlown: airborne,
    boosting: false, boostEnergy: 100, boostLocked: false,
    mach: airborne ? 240 / (343 - 140 * 0.003) : 0, gForce: 1,
  };
}

export function resetFlight(state, options = {}) {
  Object.assign(state, createFlight(options));
  return state;
}

function crash(state, reason) {
  state.crashed = true;
  state.crashReason = reason;
  state.throttle = 0;
  state.boosting = false;
}

function integrate(state, input, dt) {
  const elevator = clamp(finite(input.pitch, 0), -1, 1);
  const aileron = clamp(finite(input.roll, 0), -1, 1);
  const rudder = clamp(finite(input.yaw, 0), -1, 1);
  state.gear = input.gear ?? state.gear;
  state.flaps = input.flaps ?? state.flaps;
  state.assist = input.assist ?? state.assist;
  state.throttle = state.fuel > 0 ? clamp(finite(input.throttle, state.throttle), 0, 1) : 0;
  state.elapsed += dt;

  // A spent afterburner stays latched off until the pilot releases the control.
  // Requiring a small reserve for a new burst prevents flickering one-frame boosts.
  if (!input.boost) state.boostLocked = false;
  const boostRequest = input.boost && !state.grounded && state.speed > 55 && state.fuel > 0 && !input.airbrake;
  const boostActive = !!(boostRequest && !state.boostLocked && (state.boosting ? state.boostEnergy > 0 : state.boostEnergy >= 15));
  state.boosting = boostActive;
  state.boostEnergy = clamp(state.boostEnergy + (boostActive ? -20 : 10) * dt, 0, 100);
  if (state.boostEnergy <= 1e-6) {
    state.boostEnergy = 0;
    state.boostLocked = true;
    state.boosting = false;
  }
  state.fuel = Math.max(0, state.fuel - (0.002 + state.throttle * 0.02 + (boostActive ? 0.065 : 0)) * dt);

  const elevatorActive = Math.abs(elevator) > 0.025;
  const aileronActive = Math.abs(aileron) > 0.025;
  if (state.grounded) {
    const rotationAuthority = clamp((state.speed - 30) / 30, 0, 1);
    state.pitch = damp(state.pitch, Math.max(0, elevator) * 0.21 * rotationAuthority, 2.8, dt);
    state.roll = damp(state.roll, 0, 4, dt);
  } else {
    const pitchTarget = elevatorActive ? TRIM_PITCH + elevator * 0.62 : (state.assist ? TRIM_PITCH : state.pitch);
    state.pitch = damp(state.pitch, pitchTarget, elevatorActive ? 2.7 : 1.65, dt);
    const rollRate = aileronActive ? 3.1 : (state.assist ? 1.6 : 0.18);
    state.roll = damp(state.roll, aileronActive ? aileron * 1.2 : 0, rollRate, dt);
  }
  state.pitch = clamp(state.pitch, -0.5, 0.65);
  state.roll = clamp(state.roll, -1.2, 1.2);

  // Dry thrust balances drag near 300 m/s at full power, 240 m/s at 82%.
  // Afterburner provides a short, tangible acceleration burst, rather than a time multiplier.
  const thrust = state.grounded ? state.throttle * 28.8 : 32 * Math.pow(boostActive ? Math.max(state.throttle, 0.95) : state.throttle, 2.2) + (boostActive ? 65 : 0);
  const aerodynamicDrag = (state.grounded ? 0.0002 : 0.00035) * state.speed * state.speed;
  const baseDrag = 0.5;
  const equipmentDrag = state.grounded ? 0 : (state.gear ? 1.1 + state.speed * 0.014 : 0) + (state.flaps ? 0.6 + state.speed * state.speed * 0.0001 : 0);
  const climbDrag = state.grounded ? 0 : GRAVITY * Math.sin(state.pitch - TRIM_PITCH);
  const wheelBrake = state.grounded && input.brake ? 18 + state.speed * 0.16 : 0;
  const airBrake = !state.grounded && input.airbrake ? 11 + state.speed * 0.055 : 0;
  state.speed = clamp(state.speed + (thrust - aerodynamicDrag - baseDrag - equipmentDrag - climbDrag - wheelBrake - airBrake) * dt, 0, MAX_SPEED);

  let lateralAcceleration = 0;
  if (state.grounded) {
    // Nose-wheel steering fades with speed, so a tap does not instantly flip a fast jet.
    const steering = clamp(state.speed / 8, 0, 1) * 0.42 / (1 + state.speed / 45);
    state.heading = wrap(state.heading + rudder * steering * dt);
  } else {
    const authority = clamp(state.speed / 90, 0.15, 1);
    lateralAcceleration = clamp((GRAVITY * Math.tan(state.roll) * 1.6 + rudder * GRAVITY * 1.8) * authority, -GRAVITY * 6, GRAVITY * 6);
    const turnRate = clamp(lateralAcceleration / Math.max(state.speed, 55), -0.6, 0.6);
    state.heading = wrap(state.heading + turnRate * dt);
  }

  const stallSpeed = state.flaps ? 40 : 45;
  state.stall = !state.grounded && state.speed < stallSpeed;
  const liftRatio = clamp((state.speed - 25) / 30, 0, 1);
  const liftEfficiency = liftRatio * liftRatio * (3 - 2 * liftRatio);
  const liftShortfall = Math.max(0, stallSpeed + 3 - state.speed) * 1.25;
  const bankSink = (1 - Math.cos(state.roll)) * (state.assist ? 2.2 : 7);
  const targetClimb = clamp(state.speed * Math.sin(state.pitch - TRIM_PITCH) * 0.9 * liftEfficiency - liftShortfall - bankSink, -160, 150);

  if (state.grounded && state.speed >= 58 && elevator > 0.1 && state.pitch > 0.065 && !input.brake) {
    state.grounded = false;
    state.hasFlown = true;
    state.landed = false;
    state.verticalSpeed = Math.max(1.4, targetClimb);
  }

  const horizontalSpeed = state.speed * Math.cos(state.pitch);
  const travelled = horizontalSpeed * dt;
  state.x += Math.sin(state.heading) * travelled;
  state.z -= Math.cos(state.heading) * travelled;
  state.distance += travelled;
  state.mach = state.speed / Math.max(295, 343 - state.y * 0.003);

  if (state.grounded) {
    state.y = REST_HEIGHT;
    state.verticalSpeed = 0;
    state.stall = false;
    state.gForce = damp(state.gForce, 1, 5, dt);
    if (!runwayAt(state.x, state.z) && state.speed > 1) crash(state, '飞机冲出跑道');
    return;
  }

  state.hasFlown = true;
  const wantedVerticalSpeed = damp(state.verticalSpeed, targetClimb, 2.2, dt);
  const verticalAcceleration = clamp((wantedVerticalSpeed - state.verticalSpeed) / dt, -45, 55);
  state.verticalSpeed += verticalAcceleration * dt;
  state.y += state.verticalSpeed * dt;
  const load = clamp(Math.hypot(1 + verticalAcceleration / GRAVITY, lateralAcceleration / GRAVITY), 0, 7.5);
  state.gForce = damp(state.gForce, load, 5, dt);
  if (state.y > MAX_ALTITUDE) {
    state.y = MAX_ALTITUDE;
    state.verticalSpeed = Math.min(0, state.verticalSpeed);
  }

  if (runwayAt(state.x, state.z) && state.y <= REST_HEIGHT) {
    state.landingRate = state.verticalSpeed;
    state.y = REST_HEIGHT;
    const heading = Math.abs(wrap(state.heading));
    const aligned = Math.min(heading, Math.PI - heading) < Math.PI / 9;
    if (!state.gear) crash(state, '起落架未放下');
    else if (state.verticalSpeed <= -5) crash(state, '下降过快，重着陆');
    else if (Math.abs(state.roll) >= 0.25) crash(state, '机翼倾斜过大');
    else if (!aligned) crash(state, '未对准跑道');
    else if (state.speed >= 95) crash(state, '着陆速度过高');
    else {
      state.grounded = true;
      state.landed = state.hasFlown;
      state.verticalSpeed = 0;
      state.stall = false;
      state.boosting = false;
    }
  } else if (!runwayAt(state.x, state.z) && state.y <= 10) {
    state.y = 10;
    crash(state, '未在跑道上着陆');
  }
}

/** Mutates and returns state. Long animation gaps are capped, then substepped. */
export function stepFlight(state, controls = {}, dt = 1 / 60) {
  if (state.crashed) return state;
  let remaining = clamp(finite(dt, 0), 0, 0.1);
  while (remaining > 1e-8 && !state.crashed) {
    const step = Math.min(remaining, 1 / 60);
    integrate(state, controls, step);
    remaining -= step;
  }
  return state;
}
