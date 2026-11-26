// missions.js — Ring Run course, Island Hop objective, fuel, scoring, win states.
import * as THREE from "three";
import { RUNWAYS, heightAt } from "./terrain.js";
import { isOnRunway, whichRunway } from "./flight.js";

// Ring course: a scenic loop over the archipelago. Positions are world coords.
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
    rings: [],
    beacon: null
  };
}

export function buildMissionObjects(scene, mission) {
  clearMissionObjects(scene, mission);
  if (mission.kind === "ring") {
    const geo = new THREE.TorusGeometry(34, 3.2, 10, 28);
    RING_COURSE.forEach((p, i) => {
      const isNext = i === mission.nextRing;
      const mat = new THREE.MeshBasicMaterial({ color: isNext ? 0xffd75e : 0x4ec9ff, transparent: true, opacity: isNext ? 1 : 0.55 });
      const ring = new THREE.Mesh(geo, mat);
      ring.position.set(p.x, p.y, p.z);
      // Face the ring toward the previous point so the course reads as a path.
      const prev = i === 0 ? { x: 0, y: 120, z: 300 } : RING_COURSE[i - 1];
      ring.lookAt(prev.x, prev.y, prev.z);
      // Pulsing glow sprite at the ring center for the active ring.
      scene.add(ring);
      mission.rings.push(ring);
    });
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
  if (mission.beacon) { scene.remove(mission.beacon); mission.beacon = null; }
}

const _toRing = new THREE.Vector3();

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
      _toRing.set(p.x, p.y, p.z).sub(flight.position);
      const dist = _toRing.length();
      mission.detail += " · " + Math.round(dist) + " m";
      if (dist < 36) {
        mission.score += 500;
        mission.nextRing++;
        hud.flashMessage("RING " + mission.nextRing + "/" + total + "  +500");
        refreshRingColors(mission);
        if (mission.nextRing >= total) {
          mission.score += Math.max(0, 3000 - Math.floor(mission.elapsed) * 10);
          mission.finished = true;
          mission.finishReason = "Course complete! Every ring threaded over the archipelago.";
        }
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

  // Gentle pulse on the active ring.
  const active = mission.rings[mission.nextRing];
  if (active) {
    const s = 1 + Math.sin(mission.elapsed * 3) * 0.06;
    active.scale.set(s, s, s);
  }
}

function refreshRingColors(mission) {
  mission.rings.forEach((ring, i) => {
    if (i < mission.nextRing) {
      ring.material.color.setHex(0x57e6a9);
      ring.material.opacity = 0.35;
    } else if (i === mission.nextRing) {
      ring.material.color.setHex(0xffd75e);
      ring.material.opacity = 1;
    } else {
      ring.material.color.setHex(0x4ec9ff);
      ring.material.opacity = 0.55;
    }
    ring.scale.set(1, 1, 1);
  });
}

// Terrain height helper re-exported for staging code.
export { heightAt, isOnRunway };
