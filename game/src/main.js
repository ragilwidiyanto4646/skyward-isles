// main.js — boot, renderer, game loop, screens, screenshot staging.
import * as THREE from "three";
import { createSky, SKY_PRESET_NAMES } from "./sky.js";
import { initTerrainSeed, buildTerrain, heightAt, RUNWAYS, updateWater } from "./terrain.js";
import { buildAircraft, spinPropeller } from "./aircraft.js";
import { createFlightState, updateFlight, applyToMesh, resetFlight } from "./flight.js";
import { createCameras } from "./camera.js";
import { createCockpit3d } from "./cockpit3d.js";
import { createHud } from "./hud.js";
import { createInput } from "./input.js";
import { createMission, buildMissionObjects, updateMission, RING_COURSE } from "./missions.js";

const params = new URLSearchParams(location.search);
const seed = parseInt(params.get("seed") || "1", 10) || 1;
const shot = params.get("shot");
const skyParam = SKY_PRESET_NAMES.includes(params.get("sky")) ? params.get("sky") : "day";

initTerrainSeed(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
// ACES filmic tone mapping rolls off the bright sky/sun so island detail
// keeps contrast; exposure is set per sky preset (see sky.js). Cockpit
// glass displays use toneMapped:false materials, so they stay legible.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.getElementById("app").appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 9000);

const sky = createSky(scene, skyParam, renderer);
buildTerrain(scene);

const plane = buildAircraft();
scene.add(plane);

const flight = createFlightState();
const cameras = createCameras();
const hud = createHud();
const input = createInput();

// Debug/test hooks for the capture rig (prop-spin measurement, play-tests).
window.__plane = plane;
window.__flight = flight;
window.__cameras = cameras;

// Real 3D cockpit, attached to the camera so it renders in cockpit view.
// The old 2D cockpitFrame canvas stays hidden; the DOM HUD is unchanged.
scene.add(camera);
const cockpit3d = createCockpit3d();
camera.add(cockpit3d.group);
cockpit3d.group.visible = false;
function refreshCockpit() {
  cockpit3d.group.visible = cameras.mode === "cockpit";
  hud.setCockpitVisible(false);
}

let mission = null;
let gameState = "title"; // title | flying | paused | ended
let audio = null;

// --- Tiny procedural engine hum (WebAudio, no assets) ---
function ensureAudio() {
  if (audio) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 420;
    osc.connect(filter).connect(gain).connect(ctx.destination);
    osc.start();
    audio = { ctx, osc, gain };
  } catch (e) { audio = null; }
}
function updateAudio() {
  if (!audio) return;
  audio.osc.frequency.value = 55 + flight.throttle * 95;
  audio.gain.gain.value = gameState === "flying" ? 0.015 + flight.throttle * 0.045 : 0;
}

// --- Screens ---
const $ = (id) => document.getElementById(id);
function showScreen(id) {
  for (const s of ["titleScreen", "endScreen", "pauseScreen"]) $(s).classList.toggle("hidden", s !== id);
}
function hideScreens() {
  for (const s of ["titleScreen", "endScreen", "pauseScreen"]) $(s).classList.add("hidden");
}

function startMission(kind) {
  ensureAudio();
  mission = createMission(kind);
  buildMissionObjects(scene, mission);
  resetFlight(flight, 0);
  cameras.setMode("chase");
  refreshCockpit();
  hud.show();
  hideScreens();
  gameState = "flying";
  hud.flashMessage(kind === "ring" ? "RING RUN — GO!" : kind === "hop" ? "ISLAND HOP — TAKE OFF!" : "FREE FLIGHT");
}

function endMission() {
  gameState = "ended";
  cockpit3d.group.visible = false;
  const won = mission.finished;
  $("endTitle").textContent = won ? "MISSION COMPLETE!" : "MISSION FAILED";
  $("endText").textContent = mission.finishReason || "Flight over.";
  const m = Math.floor(mission.elapsed / 60), s = Math.floor(mission.elapsed % 60);
  $("endScore").textContent = "Score " + mission.score + " · Time " + m + ":" + String(s).padStart(2, "0");
  showScreen("endScreen");
}

$("btnRing").addEventListener("click", () => startMission("ring"));
$("btnHop").addEventListener("click", () => startMission("hop"));
$("btnFree").addEventListener("click", () => startMission("free"));
$("btnAgain").addEventListener("click", () => startMission(mission ? mission.kind : "free"));
$("btnMenu").addEventListener("click", () => { gameState = "title"; hud.hide(); showScreen("titleScreen"); });
$("btnResume").addEventListener("click", () => { gameState = "flying"; hideScreens(); });
$("btnRestart2").addEventListener("click", () => startMission(mission ? mission.kind : "free"));

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Screenshot staging ---
function stageShot(name) {
  mission = createMission("ring");
  mission.score = 1500;
  mission.elapsed = 74;
  mission.fuel = 82;
  mission.objective = "Fly through the golden ring!";
  // No hard-coded distance here: the HUD computes the live distance to the
  // next ring from the staged position (see hud.js updateMissionMeta).
  mission.detail = "Ring 1 of 10 — follow the gold ring";
  buildMissionObjects(scene, mission);
  hud.show();
  hideScreens();
  gameState = "flying";

  if (name === "chase") {
    // Behind the plane over the coast, first ring dead ahead.
    const ring = RING_COURSE[0];
    flight.position.set(ring.x + 40, ring.y - 6, ring.z + 330);
    flight.heading = 0; // facing north (-Z) toward the ring
    flight.pitch = 0.02; flight.roll = -0.12;
    flight.speed = 62; flight.throttle = 0.72; flight.onGround = false;
    flight.verticalSpeed = 1.2; // gentle climb, matches the slight nose-up pitch
    cameras.setMode("chase");
  } else if (name === "cockpit") {
    // On final approach to Home Runway, panel lit, strip ahead below.
    flight.position.set(28, 185, 720);
    flight.heading = -0.04;
    flight.pitch = -0.22; flight.roll = 0.03;
    flight.speed = 48; flight.throttle = 0.45; flight.onGround = false;
    flight.verticalSpeed = -10.5; // descent on approach, matches pitch/speed
    cameras.setMode("cockpit");
    refreshCockpit();
  } else if (name === "runway") {
    // On final approach to Home Runway: chase camera behind and above the
    // aircraft, the strip ahead centre-frame with detailed ground below.
    flight.position.set(0, 95, 640);
    flight.heading = 0;
    flight.pitch = -0.05; flight.roll = 0.04;
    flight.speed = 58; flight.throttle = 0.6; flight.onGround = false;
    cameras.setMode("chase");
  } else if (name === "panorama") {
    // High wide shot: several islands and the ring course.
    flight.position.set(150, 520, 1950);
    flight.heading = -0.25;
    flight.pitch = -0.06; flight.roll = 0.08;
    flight.speed = 70; flight.throttle = 0.8; flight.onGround = false;
    cameras.setMode("chase");
  } else if (name === "sky-day" || name === "sky-sunset" || name === "sky-cloudy") {
    // Panorama vantage with the preset forced by the shot name, pitched
    // level enough that the horizon band, islands and clouds share frame.
    sky.setPreset(name.slice(4));
    flight.position.set(150, 520, 1950);
    flight.heading = -0.25;
    flight.pitch = -0.03; flight.roll = 0.04;
    flight.speed = 70; flight.throttle = 0.8; flight.onGround = false;
    cameras.setMode("chase");
  } else if (name === "sky-aerial") {
    // High altitude looking down across the islands (default day preset).
    flight.position.set(150, 980, 2400);
    flight.heading = -0.25;
    flight.pitch = -0.35; flight.roll = 0.04;
    flight.speed = 70; flight.throttle = 0.8; flight.onGround = false;
    cameras.setMode("chase");
  } else if (name === "free-side" || name === "free-front" || name === "free-top") {
    // Free-orbit camera at a fixed angle, for checking the airframe shape:
    // side profile, front-quarter showing nose/wing taper/gear, or a
    // rear-top view showing wing planform, tail and canopy from above.
    const ring = RING_COURSE[0];
    flight.position.set(ring.x + 40, ring.y - 6, ring.z + 330);
    flight.heading = 0;
    flight.pitch = 0.02; flight.roll = 0;
    flight.speed = 62; flight.throttle = 0.72; flight.onGround = false;
    cameras.setMode("free");
    if (name === "free-side") cameras.setFreeOrbit(Math.PI / 2, 0.12, 24);
    else if (name === "free-front") cameras.setFreeOrbit(Math.PI - 0.7, 0.18, 24);
    else cameras.setFreeOrbit(0.55, 0.95, 27);
  }
  applyToMesh(flight, plane);
  cameras.update(camera, flight, plane, 1, true);
  hud.update(flight, mission, cameras.mode, 0);
  if (cameras.mode === "cockpit") cockpit3d.update(flight, mission.fuel);
  renderer.render(scene, camera);
  // A few more frames so instanced meshes and fog settle, then signal ready.
  let frames = 0;
  const tick = () => {
    applyToMesh(flight, plane);
    spinPropeller(plane, flight.throttle, 0.016);
    cameras.update(camera, flight, plane, 0.016, true);
    hud.update(flight, mission, cameras.mode, 0);
    if (cameras.mode === "cockpit") cockpit3d.update(flight, mission.fuel);
    updateWater(performance.now() / 1000);
    renderer.render(scene, camera);
    frames++;
    if (frames >= 6) window.__shotReady = true;
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// --- Main loop ---
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  window.__gameTime = (window.__gameTime || 0) + dt; // debug hook for capture rig
  if (shot) return; // staging drives its own frames

  input.poll();
  if (input.consumeRestart() && (gameState === "flying" || gameState === "ended" || gameState === "paused")) {
    startMission(mission ? mission.kind : "free");
  }
  if (input.consumePause() && (gameState === "flying" || gameState === "paused")) {
    if (gameState === "flying") { gameState = "paused"; showScreen("pauseScreen"); }
    else { gameState = "flying"; hideScreens(); }
  }
  if (input.consumeViewToggle() && gameState === "flying") {
    cameras.toggle();
    refreshCockpit();
  }
  if (input.consumeSkyToggle()) {
    // Cycle day -> sunset -> cloudy; works on the title screen too.
    const next = SKY_PRESET_NAMES[(SKY_PRESET_NAMES.indexOf(sky.getPreset()) + 1) % SKY_PRESET_NAMES.length];
    sky.setPreset(next);
    hud.flashMessage("SKY: " + next.toUpperCase());
  }

  if (gameState === "flying" && mission) {
    input.orbitMode = cameras.mode === "free";
    updateFlight(flight, input, dt);
    updateMission(mission, flight, dt, hud);
    applyToMesh(flight, plane);
    spinPropeller(plane, flight.throttle, dt);
    cameras.update(camera, flight, plane, dt, false, input);
    hud.update(flight, mission, cameras.mode, dt);
    if (cameras.mode === "cockpit") cockpit3d.update(flight, mission.fuel);
    if (mission.finished || mission.failed) endMission();
  } else if (gameState === "title") {
    // Slow orbit around the parked plane behind the title card.
    resetFlight(flight, 0);
    applyToMesh(flight, plane);
    const t = now / 1000 * 0.12;
    camera.position.set(flight.position.x + Math.sin(t) * 42, flight.position.y + 13, flight.position.z + Math.cos(t) * 42);
    camera.lookAt(flight.position.x, flight.position.y + 2, flight.position.z);
    spinPropeller(plane, 0.15, dt);
  }
  updateWater(now / 1000);
  updateAudio();
  renderer.render(scene, camera);
}

if (shot) {
  stageShot(shot);
} else {
  resetFlight(flight, 0);
  requestAnimationFrame(loop);
}
