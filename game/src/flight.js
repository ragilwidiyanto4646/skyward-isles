// flight.js — arcade flight model: throttle, banked turns, stall sink, ground handling.
import * as THREE from "three";
import { heightAt, RUNWAYS, runwayLocalInto } from "./terrain.js";

export const FLIGHT = {
  MAX_SPEED: 95,      // world units per second at full throttle
  STALL_SPEED: 26,    // below this the plane sinks
  TAKEOFF_SPEED: 30,
  GRAVITY_SINK: 14
};

export function createFlightState() {
  return {
    position: new THREE.Vector3(0, 17, 240),
    heading: 0,        // radians, 0 = north (-Z)
    pitch: 0,
    roll: 0,
    // Smoothed attitude rates (rad/s). Input sets a target rate and these
    // ease toward it, so the nose/wing roll in with a touch of inertia
    // instead of snapping to full rate on the first frame of input.
    pitchRateSm: 0,
    rollRateSm: 0,
    speed: 0,          // units/sec
    throttle: 0,       // 0..1
    onGround: true,
    verticalSpeed: 0,
    crashed: false,
    landed: false,     // gentle touchdown this frame (for refuel)
    forward: new THREE.Vector3(0, 0, -1)
  };
}

const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

export function updateFlight(state, input, dt) {
  state.landed = false;
  if (state.crashed) return;

  // Throttle ramps toward held keys.
  if (input.throttleUp) state.throttle = Math.min(1, state.throttle + dt * 0.85);
  if (input.throttleDown) state.throttle = Math.max(0, state.throttle - dt * 0.9);

  const targetSpeed = state.throttle * FLIGHT.MAX_SPEED;
  const accel = state.onGround ? 20 : 12;
  state.speed += (targetSpeed - state.speed) * Math.min(1, dt * (accel / 30) * 3);
  if (state.onGround && state.throttle < 0.05) state.speed = Math.max(0, state.speed - dt * 12);

  // Control authority grows with airspeed.
  const authority = THREE.MathUtils.clamp(state.speed / 55, 0.15, 1);
  const pitchRate = 1.05 * authority;
  const rollRate = 1.9 * authority;

  // Ease the actual attitude rates toward the input-driven targets
  // (time constant ~0.08 s): full rate is still reached quickly, but the
  // first frames of a pitch/roll input ramp in instead of snapping.
  const rateEase = 1 - Math.exp(-dt * 12);
  if (!state.onGround || state.speed > FLIGHT.TAKEOFF_SPEED * 0.7) {
    state.pitchRateSm += (input.pitchInput * pitchRate - state.pitchRateSm) * rateEase;
    state.pitch += state.pitchRateSm * dt;
    state.pitch = THREE.MathUtils.clamp(state.pitch, -0.95, 0.95);
  } else {
    state.pitch *= Math.max(0, 1 - dt * 4);
    state.pitchRateSm *= Math.max(0, 1 - dt * 4);
  }
  state.rollRateSm += (input.rollInput * rollRate - state.rollRateSm) * rateEase;
  state.roll += state.rollRateSm * dt;
  // Wings drift back toward level when no roll input.
  if (Math.abs(input.rollInput) < 0.05) state.roll -= state.roll * Math.min(1, dt * 1.4);
  state.roll = THREE.MathUtils.clamp(state.roll, -1.25, 1.25);

  // Banked turn: heading change proportional to bank and speed.
  if (!state.onGround) {
    state.heading += Math.sin(state.roll) * 0.85 * dt * THREE.MathUtils.clamp(state.speed / 60, 0.3, 1.4);
  } else if (state.speed > 4) {
    // Gentle ground steering with roll input.
    state.heading += input.rollInput * 0.35 * dt * (state.speed / 30);
  }

  _euler.set(state.pitch, state.heading, state.roll, "YXZ");
  _quat.setFromEuler(_euler);
  state.forward.set(0, 0, -1).applyQuaternion(_quat);

  const prevY = state.position.y;
  state.position.addScaledVector(state.forward, state.speed * dt);

  // Stall: too slow in the air means sinking.
  if (!state.onGround && state.speed < FLIGHT.STALL_SPEED) {
    const sink = (FLIGHT.STALL_SPEED - state.speed) / FLIGHT.STALL_SPEED;
    state.position.y -= FLIGHT.GRAVITY_SINK * sink * dt;
    state.pitch = Math.max(-0.5, state.pitch - dt * 0.35 * sink);
  }
  state.verticalSpeed = dt > 0 ? (state.position.y - prevY) / dt : 0;

  // Ground interaction.
  const groundY = Math.max(0.4, heightAt(state.position.x, state.position.z));
  const gearY = groundY + 2.6;
  if (state.position.y <= gearY) {
    const gentle = state.verticalSpeed > -9 && Math.abs(state.pitch) < 0.35 && Math.abs(state.roll) < 0.45;
    const onRunway = isOnRunway(state.position.x, state.position.z);
    if (!state.onGround && (!gentle || !onRunway) && state.speed > 12) {
      state.crashed = true;
      state.position.y = gearY;
      return;
    }
    if (!state.onGround && gentle && onRunway) state.landed = true;
    state.onGround = true;
    state.position.y = gearY;
    state.pitch *= Math.max(0, 1 - dt * 6);
    state.roll *= Math.max(0, 1 - dt * 6);
  } else if (state.onGround) {
    // Lift off once fast enough and pitching up (or rolling off a slope).
    if (state.speed > FLIGHT.TAKEOFF_SPEED && state.pitch > 0.04) {
      state.onGround = false;
    } else if (state.position.y > gearY + 3 && state.speed > FLIGHT.TAKEOFF_SPEED) {
      state.onGround = false;
    } else {
      state.position.y = gearY;
    }
  }

  // Keep the plane inside the world.
  const R = 2600;
  state.position.x = THREE.MathUtils.clamp(state.position.x, -R, R);
  state.position.z = THREE.MathUtils.clamp(state.position.z, -R, R);
  state.position.y = Math.min(state.position.y, 900);
}

const _rwLocal = { lx: 0, lz: 0 };

export function isOnRunway(x, z) {
  for (const rw of RUNWAYS) {
    const { lx, lz } = runwayLocalInto(x, z, rw, _rwLocal);
    if (Math.abs(lx) < rw.width / 2 + 6 && Math.abs(lz) < rw.length / 2 + 6) return true;
  }
  return false;
}

export function whichRunway(x, z) {
  for (const rw of RUNWAYS) {
    const { lx, lz } = runwayLocalInto(x, z, rw, _rwLocal);
    if (Math.abs(lx) < rw.width / 2 + 6 && Math.abs(lz) < rw.length / 2 + 6) return rw;
  }
  return null;
}

export function applyToMesh(state, mesh) {
  mesh.position.copy(state.position);
  _euler.set(state.pitch, state.heading, state.roll, "YXZ");
  mesh.quaternion.setFromEuler(_euler);
}

export function resetFlight(state, runwayIndex = 0) {
  const rw = RUNWAYS[runwayIndex];
  // Start at the south end of the runway, facing along its heading.
  const back = rw.length / 2 - 60;
  const dx = Math.sin(rw.heading) * back;
  const dz = Math.cos(rw.heading) * back;
  state.position.set(rw.x + dx, rw.elev + 2.6, rw.z + dz);
  state.heading = rw.heading;
  state.pitch = 0;
  state.roll = 0;
  state.pitchRateSm = 0;
  state.rollRateSm = 0;
  state.speed = 0;
  state.throttle = 0;
  state.onGround = true;
  state.crashed = false;
  state.verticalSpeed = 0;
}
