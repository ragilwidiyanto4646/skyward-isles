// missions.js — Ring Run course, Island Hop objective, fuel, scoring, win states.
//
// Phase 4 (Ring Challenge) adds, on top of the plain gold/blue/green tori:
//   - readable ring rotation: 4 marker beads on each rim orbit as the ring
//     spins about the course axis (a bare torus spinning about its own
//     symmetry axis would be invisible). The active ring is a thick solid
//     gold torus — an earlier additive centre halo washed it out into a
//     glowing blob, so the halo sprite is built but never shown;
//   - a pooled particle burst at the ring centre on every pass;
//   - WebAudio checkpoint sounds (two-note chime on pass, low blip on miss),
//     created lazily on the first user gesture, fully guarded;
//   - missed-ring feedback: fly within ~90 m of the active ring and then
//     recede past ~140 m without threading it and the HUD says turn back.
//     The ring stays active, so a turn-back still counts.
import * as THREE from "three";
import { RUNWAYS, heightAt } from "./terrain.js";
import { isOnRunway, whichRunway } from "./flight.js";

// Ring course: a scenic loop over the archipelago. Positions are world coords.
// Heights (150–240) and leg directions already vary ring to ring; Phase 4
// keeps the course as-is — it reads well in play and every ring is reachable
// from the previous one. NOTE: hud.js imports this export and relies on the
// {x, y, z} shape for the live distance readout — keep it intact.
export const RING_COURSE = [
  { x: 0, y: 150, z: -650 },
  { x: -650, y: 190, z: -1050 },
  { x: -1450, y: 170, z: -800 },
  { x: -1150, y: 210, z: 150 },
  { x: -900, y: 180, z: 1350 },
  { x: 0, y: 220, z: 1050 },
  { x: 1200, y: 190, z: 1250 },
  { x: 1650, y: 230, z: 250 },
  { x: 1500, y: 200, z: -1050 },
  { x: 300, y: 240, z: -1750 }
];

const RING_RADIUS = 34;          // torus ring radius (visual + pass gate ~36)
const RING_PASS_DIST = 36;       // 3D distance to centre that counts as a pass
const MISS_ARM_DIST = 90;        // closest approach that arms miss detection
const MISS_FIRE_DIST = 140;      // recede past this (armed, no pass) => missed
const PARTICLE_POOL = 160;       // pooled burst particles, allocated once
const PARTICLES_PER_BURST = 40;

// Deep, saturated gold: the old pale 0xffd75e washed out to near-white
// under ACES tone mapping, so the active ring read as a faint glow
// instead of a solid gold target. This stays unmistakably gold at
// screenshot distance.
const COL_GOLD = 0xffb52e;
const COL_BLUE = 0x4ec9ff;
const COL_GREEN = 0x57e6a9;

// Marker-bead tint: the ring colour lightened only slightly toward
// white, so the orbiting beads read as subtle markers on a solid ring
// rather than white segments breaking the torus up.
const _beadTint = new THREE.Color();
const _white = new THREE.Color(0xffffff);
function beadTint(hex) {
  return _beadTint.setHex(hex).lerp(_white, 0.12).getHex();
}

export function createMission(kind) {
  return {
    kind, // "ring" | "hop" | "free"
    title: kind === "ring" ? "RING RUN" : kind === "hop" ? "ISLAND HOP" : "FREE FLIGHT",
    objective: "",
    detail: "",
    score: 0,
    fuel: 100,
    elapsed: 0,
    finished: false,
    failed: false,
    finishReason: "",
    nextRing: 0,
    ringsTotal: RING_COURSE.length,
    tookOff: false,
    rings: [],          // one THREE.Group per ring (torus + spinner + halo)
    beacon: null,
    // Phase 4 state:
    ringSpin: 0,                  // shared spin angle, advanced by dt
    particles: null,              // pooled THREE.Points burst system
    closestToRing: Infinity,      // closest approach to the active ring
    missFiredForRing: -1          // ring index the miss message last fired for
  };
}

// ---------------------------------------------------------------------------
// Checkpoint sounds (WebAudio, oscillator-only — no audio files, offline-safe)
// ---------------------------------------------------------------------------

let audioCtx = null;

// Create/resume the shared AudioContext. Called from main.js on mission
// start (a click = user gesture) and from the one-time listeners below, so
// autoplay policies are satisfied. Never throws: audio is a garnish.
export function initMissionAudio() {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch (e) { /* no audio — the game carries on silently */ }
}

if (typeof window !== "undefined") {
  const armAudioOnce = () => initMissionAudio();
  window.addEventListener("pointerdown", armAudioOnce, { once: true });
  window.addEventListener("keydown", armAudioOnce, { once: true });
}

// One enveloped oscillator note. Guarded end-to-end.
function playNote(freqStart, freqEnd, type, delay, dur, vol) {
  try {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  } catch (e) { /* ignore — never let a sound break the frame */ }
}

// Pleasant two-note chime on ring pass (E6 -> A6, soft sine).
function playRingChime() {
  if (typeof window !== "undefined") window.__ringChimeCount = (window.__ringChimeCount || 0) + 1;
  playNote(1318.5, 1318.5, "sine", 0, 0.38, 0.11);
  playNote(1760.0, 1760.0, "sine", 0.09, 0.45, 0.11);
}

// Low descending blip when a ring is missed.
function playMissSound() {
  if (typeof window !== "undefined") window.__missSoundCount = (window.__missSoundCount || 0) + 1;
  playNote(196, 110, "triangle", 0, 0.3, 0.09);
}

// ---------------------------------------------------------------------------
// Particle burst pool (created once per mission, reused on every pass)
// ---------------------------------------------------------------------------

function createParticlePool(scene, mission) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(PARTICLE_POOL * 3);
  const colors = new Float32Array(PARTICLE_POOL * 3);
  // Park every particle far below the world until first use.
  for (let i = 0; i < PARTICLE_POOL; i++) positions[i * 3 + 1] = -9999;
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 4, sizeAttenuation: true, vertexColors: true,
    map: makeHaloTexture(), // soft round sprite, not a hard square
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  mission.particles = {
    points,
    velocities: new Float32Array(PARTICLE_POOL * 3),
    baseColors: new Float32Array(PARTICLE_POOL * 3),
    life: new Float32Array(PARTICLE_POOL),     // seconds remaining (0 = dead)
    maxLife: new Float32Array(PARTICLE_POOL),
    cursor: 0                                   // round-robin spawn index
  };
}

const _burstColor = new THREE.Color();

// Fire one burst of PARTICLES_PER_BURST particles at a ring centre.
// Reuses pool slots round-robin; no allocation.
function burstAt(mission, center) {
  const p = mission.particles;
  if (!p) return;
  const pos = p.points.geometry.attributes.position.array;
  for (let n = 0; n < PARTICLES_PER_BURST; n++) {
    const i = p.cursor;
    p.cursor = (p.cursor + 1) % PARTICLE_POOL;
    const i3 = i * 3;
    pos[i3] = center.x; pos[i3 + 1] = center.y; pos[i3 + 2] = center.z;
    // Random direction on a sphere, biased outward at 14–34 units/s.
    const theta = Math.random() * Math.PI * 2;
    const z = Math.random() * 2 - 1;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const speed = 14 + Math.random() * 20;
    p.velocities[i3] = Math.cos(theta) * r * speed;
    p.velocities[i3 + 1] = z * speed;
    p.velocities[i3 + 2] = Math.sin(theta) * r * speed;
    // Gold or green, matching the pass palette.
    _burstColor.setHex(Math.random() < 0.5 ? COL_GOLD : COL_GREEN);
    p.baseColors[i3] = _burstColor.r;
    p.baseColors[i3 + 1] = _burstColor.g;
    p.baseColors[i3 + 2] = _burstColor.b;
    p.maxLife[i] = 0.7 + Math.random() * 0.3;
    p.life[i] = p.maxLife[i];
  }
  if (typeof window !== "undefined") window.__ringBurstCount = (window.__ringBurstCount || 0) + 1;
}

// Advance live particles: drift with drag, fade colour toward black
// (additive blending => black is invisible), park when dead.
function updateParticles(mission, dt) {
  const p = mission.particles;
  if (!p) return;
  const posAttr = p.points.geometry.attributes.position;
  const colAttr = p.points.geometry.attributes.color;
  const pos = posAttr.array;
  const col = colAttr.array;
  const drag = Math.max(0, 1 - 1.6 * dt);
  let touched = false;
  for (let i = 0; i < PARTICLE_POOL; i++) {
    if (p.life[i] <= 0) continue;
    touched = true;
    p.life[i] -= dt;
    const i3 = i * 3;
    if (p.life[i] <= 0) {
      pos[i3 + 1] = -9999;
      col[i3] = col[i3 + 1] = col[i3 + 2] = 0;
      continue;
    }
    p.velocities[i3] *= drag;
    p.velocities[i3 + 1] *= drag;
    p.velocities[i3 + 2] *= drag;
    pos[i3] += p.velocities[i3] * dt;
    pos[i3 + 1] += p.velocities[i3 + 1] * dt;
    pos[i3 + 2] += p.velocities[i3 + 2] * dt;
    const fade = p.life[i] / p.maxLife[i];
    col[i3] = p.baseColors[i3] * fade;
    col[i3 + 1] = p.baseColors[i3 + 1] * fade;
    col[i3 + 2] = p.baseColors[i3 + 2] * fade;
  }
  // Only re-upload the buffers when a particle actually moved or died
  // this frame; an idle pool (the common case) costs no GPU upload.
  if (touched) {
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Ring visuals
// ---------------------------------------------------------------------------

// Soft radial-gradient sprite texture for the active ring's glow halo.
// Generated on a canvas — no external asset.
function makeHaloTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function buildMissionObjects(scene, mission) {
  clearMissionObjects(scene, mission);
  if (mission.kind === "ring") {
    // Thick torus tube (4.6) so the ring reads as a solid band, not a
    // thin wire, from a few hundred metres out. Beads sit just proud
    // of the tube (5.0) so the spin stays readable without segmenting
    // the ring's silhouette.
    const torusGeo = new THREE.TorusGeometry(RING_RADIUS, 4.6, 12, 36);
    const beadGeo = new THREE.SphereGeometry(5.0, 10, 8);
    const haloTex = makeHaloTexture();
    RING_COURSE.forEach((p, i) => {
      const isNext = i === mission.nextRing;
      const group = new THREE.Group();
      group.position.set(p.x, p.y, p.z);
      // Face the ring toward the previous point so the course reads as a path.
      const prev = i === 0 ? { x: 0, y: 120, z: 300 } : RING_COURSE[i - 1];
      group.lookAt(prev.x, prev.y, prev.z);

      // The torus itself (local XY plane, axis = local Z = course direction).
      const torusMat = new THREE.MeshBasicMaterial({
        color: isNext ? COL_GOLD : COL_BLUE, transparent: true, opacity: isNext ? 1 : 0.55
      });
      const torus = new THREE.Mesh(torusGeo, torusMat);
      group.add(torus);

      // Spinner: 4 marker beads on the rim. Rotating this group about the
      // local Z axis makes the ring's spin readable from the cockpit. Beads
      // are tinted toward white so they stand out against the torus tube.
      const spinner = new THREE.Group();
      const beadMat = new THREE.MeshBasicMaterial({
        color: beadTint(isNext ? COL_GOLD : COL_BLUE), transparent: true, opacity: isNext ? 1 : 0.55
      });
      for (let b = 0; b < 4; b++) {
        const a = (b / 4) * Math.PI * 2;
        const bead = new THREE.Mesh(beadGeo, beadMat);
        bead.position.set(Math.cos(a) * RING_RADIUS, Math.sin(a) * RING_RADIUS, 0);
        spinner.add(bead);
      }
      group.add(spinner);

      // Centre glow halo: kept in the scene graph (the pass-burst
      // particles still use the same soft texture) but never shown.
      // At 150 units wide the additive sprite filled the ring's hole
      // with a white glare blob, so the active ring read as a small
      // glowing sun instead of a solid gold target ring. The ring
      // itself — thick gold torus, subtle beads, gentle pulse — is
      // the marker now.
      const haloMat = new THREE.SpriteMaterial({
        map: haloTex, color: COL_GOLD, transparent: true, opacity: 0.4,
        depthWrite: false, blending: THREE.AdditiveBlending
      });
      const halo = new THREE.Sprite(haloMat);
      halo.scale.set(150, 150, 1);
      halo.visible = false;
      group.add(halo);

      group.userData = { torusMat, beadMat, spinner, halo, haloMat, phase: i * 0.8 };
      scene.add(group);
      mission.rings.push(group);
    });
    createParticlePool(scene, mission);
  }
  if (mission.kind === "hop") {
    const target = RUNWAYS[1];
    const beaconGeo = new THREE.CylinderGeometry(10, 10, 340, 12, 1, true);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xffd75e, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.position.set(target.x, target.elev + 170, target.z);
    scene.add(beacon);
    mission.beacon = beacon;
  }
}

export function clearMissionObjects(scene, mission) {
  for (const r of mission.rings) scene.remove(r);
  mission.rings = [];
  if (mission.particles) { scene.remove(mission.particles.points); mission.particles = null; }
  if (mission.beacon) { scene.remove(mission.beacon); mission.beacon = null; }
}

const _toRing = new THREE.Vector3();
const _ringCenter = new THREE.Vector3();

export function updateMission(mission, flight, dt, hud) {
  if (mission.finished || mission.failed) return;
  mission.elapsed += dt;

  // Fuel drains with throttle; refills when landed on a runway.
  if (!flight.onGround) {
    mission.fuel = Math.max(0, mission.fuel - dt * (0.55 + flight.throttle * 1.5));
    if (mission.fuel <= 0) {
      flight.throttle = 0;
      mission.objective = "OUT OF FUEL — glide to a runway!";
    }
  }
  if (flight.landed) {
    mission.fuel = 100;
    hud.flashMessage("LANDED — REFUELED!");
    if (mission.kind === "free") mission.score += 250;
  }

  if (flight.crashed) {
    mission.failed = true;
    mission.finishReason = "You crashed into the terrain. The isles are unforgiving at low altitude!";
    return;
  }

  if (mission.kind === "ring") {
    const total = mission.ringsTotal;
    mission.objective = "Fly through the golden ring!";
    mission.detail = "Ring " + Math.min(mission.nextRing + 1, total) + " of " + total + " — follow the gold ring";
    if (mission.nextRing < total) {
      const p = RING_COURSE[mission.nextRing];
      _ringCenter.set(p.x, p.y, p.z);
      _toRing.copy(_ringCenter).sub(flight.position);
      const dist = _toRing.length();
      mission.detail += " · " + Math.round(dist) + " m";

      if (dist < mission.closestToRing) mission.closestToRing = dist;

      if (dist < RING_PASS_DIST) {
        // --- Ring threaded: score, burst, chime, advance. ---
        mission.score += 500;
        mission.nextRing++;
        mission.closestToRing = Infinity;
        burstAt(mission, _ringCenter);
        playRingChime();
        hud.flashMessage("RING " + mission.nextRing + "/" + total + "  +500");
        refreshRingColors(mission);
        if (mission.nextRing >= total) {
          mission.score += Math.max(0, 3000 - Math.floor(mission.elapsed) * 10);
          mission.finished = true;
          mission.finishReason = "Course complete! Every ring threaded over the archipelago.";
        }
      } else if (
        mission.closestToRing < MISS_ARM_DIST &&
        dist > MISS_FIRE_DIST &&
        mission.missFiredForRing !== mission.nextRing
      ) {
        // --- Flew close, then receded without threading: missed. The ring
        // stays active; re-arm only after another close approach. ---
        mission.missFiredForRing = mission.nextRing;
        mission.closestToRing = Infinity;
        playMissSound();
        hud.flashMessage("RING MISSED — TURN BACK!");
      }
    }
  } else if (mission.kind === "hop") {
    const target = RUNWAYS[1];
    if (!mission.tookOff) {
      mission.objective = "Take off from Home Runway";
      mission.detail = "Throttle up (W), pull up gently past 60 kt";
      if (!flight.onGround && flight.position.y > 60) {
        mission.tookOff = true;
        hud.flashMessage("AIRBORNE — HEAD FOR THE GOLD BEACON!");
      }
    } else {
      const d = Math.hypot(flight.position.x - target.x, flight.position.z - target.z);
      mission.objective = "Land on Far Strip (gold beacon)";
      mission.detail = "Distance " + Math.round(d) + " m — touch down gently on the strip";
      if (flight.landed && whichRunway(flight.position.x, flight.position.z) === target) {
        mission.score += 1500 + Math.max(0, 1500 - Math.floor(mission.elapsed) * 5);
        mission.finished = true;
        mission.finishReason = "Island hop complete! A clean arrival on Far Strip.";
      }
    }
    if (mission.beacon) mission.beacon.rotation.y += dt * 0.4;
  } else {
    mission.objective = "Explore the Skyward Isles";
    const h = Math.round(flight.position.y * 3.28);
    mission.detail = "Altitude " + h + " ft — land on any runway to refuel (+250)";
    if (!flight.onGround) mission.score += Math.floor(dt * 2);
  }

  // Ring animation: every ring's beads orbit the rim; the active ring also
  // pulses gently in scale. (Its old centre halo sprite is never shown —
  // see buildMissionObjects — so the opacity/scale writes below are
  // harmless.) No allocations in this loop.
  if (mission.kind === "ring" && mission.rings.length) {
    mission.ringSpin += dt * 0.9;
    const pulse = Math.sin(mission.elapsed * 3);
    for (let i = 0; i < mission.rings.length; i++) {
      const ring = mission.rings[i];
      const u = ring.userData;
      u.spinner.rotation.z = mission.ringSpin + u.phase;
      if (i === mission.nextRing) {
        const s = 1 + pulse * 0.06;
        ring.scale.set(s, s, s);
        u.haloMat.opacity = 0.32 + pulse * 0.14;
        const hs = 150 + pulse * 18;
        u.halo.scale.set(hs, hs, 1);
      }
    }
    updateParticles(mission, dt);
  }
}

function refreshRingColors(mission) {
  mission.rings.forEach((ring, i) => {
    const u = ring.userData;
    let color, opacity;
    if (i < mission.nextRing) { color = COL_GREEN; opacity = 0.35; }
    else if (i === mission.nextRing) { color = COL_GOLD; opacity = 1; }
    else { color = COL_BLUE; opacity = 0.55; }
    u.torusMat.color.setHex(color);
    u.torusMat.opacity = opacity;
    u.beadMat.color.setHex(beadTint(color));
    u.beadMat.opacity = opacity;
    u.halo.visible = false; // centre glare stays off — see buildMissionObjects
    ring.scale.set(1, 1, 1);
  });
}

// Terrain height helper re-exported for staging code.
export { heightAt, isOnRunway };
