// terrain.js — seeded archipelago heightfield, water, runways, town and trees.
import * as THREE from "three";

// Deterministic PRNG so ?seed= gives the same world every load.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Small value-noise field built from a seeded permutation grid.
function makeNoise(rng) {
  const grid = new Float32Array(256 * 256);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  function sample(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z);
    const xf = x - xi, zf = z - zi;
    const sx = xf * xf * (3 - 2 * xf);
    const sz = zf * zf * (3 - 2 * zf);
    const g = (a, b) => grid[(((a & 255) << 8) + (b & 255))];
    const v00 = g(xi, zi), v10 = g(xi + 1, zi), v01 = g(xi, zi + 1), v11 = g(xi + 1, zi + 1);
    return v00 + (v10 - v00) * sx + (v01 - v00) * sz + (v00 - v10 - v01 + v11) * sx * sz;
  }
  return function fbm(x, z) {
    return sample(x, z) * 0.55 + sample(x * 2.1, z * 2.1) * 0.3 + sample(x * 4.3, z * 4.3) * 0.15;
  };
}

// Island definitions: center, radius, peak height.
export const ISLANDS = [
  { x: 0, z: 0, r: 950, h: 120, name: "Home Island" },
  { x: 1500, z: -1050, r: 620, h: 95, name: "Far Island" },
  { x: -1450, z: -800, r: 560, h: 80, name: "West Isle" },
  { x: -900, z: 1350, r: 520, h: 70, name: "South Isle" },
  { x: 1200, z: 1250, r: 480, h: 65, name: "East Isle" },
  { x: 300, z: -1750, r: 420, h: 55, name: "North Cay" }
];

// Runways: center, heading (radians, 0 = along -Z), length, width, elevation.
export const RUNWAYS = [
  { x: 0, z: 60, heading: 0, length: 560, width: 44, elev: 14, name: "Home Runway" },
  { x: 1500, z: -1050, heading: 0.6, length: 420, width: 38, elev: 16, name: "Far Strip" }
];

let noiseFn = null;
let worldSeed = 1;

export function initTerrainSeed(seed) {
  worldSeed = seed;
  noiseFn = makeNoise(mulberry32(seed * 7919 + 13));
}

// Raw island height before runway flattening.
function islandHeight(x, z) {
  let h = -14;
  for (const isl of ISLANDS) {
    const dx = x - isl.x, dz = z - isl.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < isl.r * 1.35) {
      const t = Math.max(0, 1 - d / isl.r);
      const dome = Math.pow(t, 1.35) * isl.h;
      const n = noiseFn(x * 0.004 + isl.x * 0.01, z * 0.004 + isl.z * 0.01);
      const ridge = (n - 0.45) * 58 * Math.min(1, t * 2.2);
      h = Math.max(h, dome + ridge - 6);
    }
  }
  return h;
}

// Distance from a point to a runway rectangle in runway-local space.
export function runwayLocal(x, z, rw) {
  const dx = x - rw.x, dz = z - rw.z;
  const c = Math.cos(-rw.heading), s = Math.sin(-rw.heading);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return { lx, lz };
}

export function heightAt(x, z) {
  let h = islandHeight(x, z);
  for (const rw of RUNWAYS) {
    const { lx, lz } = runwayLocal(x, z, rw);
    const halfL = rw.length / 2 + 300;
    const halfW = rw.width / 2 + 150;
    if (Math.abs(lx) < halfW && Math.abs(lz) < halfL) {
      const fx = 1 - Math.max(0, (Math.abs(lx) - rw.width / 2) / 150);
      const fz = 1 - Math.max(0, (Math.abs(lz) - rw.length / 2) / 300);
      const f = Math.min(1, Math.max(0, fx)) * Math.min(1, Math.max(0, fz));
      const s = f * f * (3 - 2 * f);
      h = h * (1 - s) + rw.elev * s;
    }
  }
  return h;
}

function colorForHeight(h, slope) {
  const c = new THREE.Color();
  if (h < 1.2) c.setHex(0xe8d29a);            // sandy beach
  else if (h < 42) c.setHex(0x57a84e);        // green hills
  else if (h < 72) c.setHex(0x7d9b52);        // dry grass / scrub
  else c.setHex(0x9a9a9a);                     // grey peaks
  if (slope > 0.55) c.lerp(new THREE.Color(0x8a7a68), 0.6);
  return c;
}

export function buildTerrain(scene) {
  const SIZE = 5200;
  const SEG = 150;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i);
    const slope = 1 - nrm.getY(i);
    const c = colorForHeight(h, slope);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(mesh);

  // Water plane.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000),
    new THREE.MeshPhongMaterial({ color: 0x1f7fb8, shininess: 90, specular: 0x99d9ff, transparent: true, opacity: 0.94 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0;
  scene.add(water);

  for (const rw of RUNWAYS) scene.add(buildRunway(rw));
  scene.add(buildTown());
  scene.add(buildTrees());
  return mesh;
}

function buildRunway(rw) {
  const group = new THREE.Group();
  group.position.set(rw.x, rw.elev + 0.35, rw.z);
  group.rotation.y = rw.heading;

  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(rw.width, rw.length),
    new THREE.MeshLambertMaterial({ color: 0x3a3f46 })
  );
  strip.rotation.x = -Math.PI / 2;
  group.add(strip);

  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  // Centerline dashes.
  for (let z = -rw.length / 2 + 40; z < rw.length / 2 - 20; z += 46) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 24), white);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(0, 0.15, z);
    group.add(dash);
  }
  // Threshold markings at both ends.
  for (const end of [-1, 1]) {
    for (let i = -2; i <= 2; i++) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 26), white);
      bar.rotation.x = -Math.PI / 2;
      bar.position.set(i * 7.5, 0.15, end * (rw.length / 2 - 22));
      group.add(bar);
    }
  }
  // Edge lights.
  const lightGeo = new THREE.SphereGeometry(1.5, 8, 6);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffd75e });
  for (let z = -rw.length / 2; z <= rw.length / 2; z += 40) {
    for (const side of [-1, 1]) {
      const lamp = new THREE.Mesh(lightGeo, lightMat);
      lamp.position.set(side * (rw.width / 2 + 3), 1.2, z);
      group.add(lamp);
    }
  }
  return group;
}

function buildTown() {
  const group = new THREE.Group();
  const rng = mulberry32(worldSeed * 31 + 7);
  const wallColors = [0xf2e3c8, 0xe8b4a0, 0xbcd3e8, 0xf7f0dd, 0xd9e6c3];
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xb0503c });
  const windowMat = new THREE.MeshBasicMaterial({ color: 0xffd75e });
  for (let i = 0; i < 42; i++) {
    const gx = 150 + (i % 7) * 52 + rng() * 18;
    const gz = -160 + Math.floor(i / 7) * 58 + rng() * 18;
    const h = 14 + rng() * 30;
    const w = 20 + rng() * 14;
    const d = 20 + rng() * 14;
    const base = heightAt(gx, gz);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color: wallColors[i % wallColors.length] })
    );
    body.position.set(gx, base + h / 2, gz);
    group.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, 8, 4), roofMat);
    roof.position.set(gx, base + h + 4, gz);
    roof.rotation.y = Math.PI / 4;
    group.add(roof);
    // A couple of lit windows facing the runway.
    for (let k = 0; k < 3; k++) {
      if (rng() < 0.45) continue;
      const win = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), windowMat);
      win.position.set(gx - w / 2 - 0.15, base + 6 + k * (h / 3.2), gz + (rng() - 0.5) * d * 0.6);
      win.rotation.y = -Math.PI / 2;
      group.add(win);
    }
  }
  return group;
}

function buildTrees() {
  const rng = mulberry32(worldSeed * 101 + 3);
  const trunkGeo = new THREE.CylinderGeometry(1.1, 1.5, 7, 6);
  const coneGeo = new THREE.ConeGeometry(6.5, 17, 8);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2f7d3a });
  const COUNT = 420;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, COUNT);
  const cones = new THREE.InstancedMesh(coneGeo, leafMat, COUNT);
  const m = new THREE.Matrix4();
  let placed = 0;
  let guard = 0;
  while (placed < COUNT && guard < COUNT * 30) {
    guard++;
    const isl = ISLANDS[Math.floor(rng() * ISLANDS.length)];
    const ang = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * isl.r * 0.92;
    const x = isl.x + Math.cos(ang) * rad;
    const z = isl.z + Math.sin(ang) * rad;
    const h = heightAt(x, z);
    if (h < 3 || h > 58) continue;
    let onRunway = false;
    for (const rw of RUNWAYS) {
      const { lx, lz } = runwayLocal(x, z, rw);
      if (Math.abs(lx) < rw.width && Math.abs(lz) < rw.length / 2 + 40) onRunway = true;
    }
    if (onRunway) continue;
    const s = 0.8 + rng() * 0.9;
    m.makeScale(s, s, s).setPosition(x, h + 3.2 * s, z);
    trunks.setMatrixAt(placed, m);
    m.makeScale(s, s, s).setPosition(x, h + (7 + 8) * s, z);
    cones.setMatrixAt(placed, m);
    placed++;
  }
  trunks.count = placed;
  cones.count = placed;
  const group = new THREE.Group();
  group.add(trunks, cones);
  return group;
}
