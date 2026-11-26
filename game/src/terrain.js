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

// Raw island height before runway flattening. Two noise octaves plus a
// ridged component (1-|n|) give hills and crests instead of one smooth dome.
function islandHeight(x, z) {
  let h = -14;
  for (const isl of ISLANDS) {
    const dx = x - isl.x, dz = z - isl.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < isl.r * 1.35) {
      const t = Math.max(0, 1 - d / isl.r);
      const dome = Math.pow(t, 1.35) * isl.h;
      const n1 = noiseFn(x * 0.004 + isl.x * 0.01, z * 0.004 + isl.z * 0.01);
      const n2 = noiseFn(x * 0.011 + 7.3 + isl.x * 0.01, z * 0.011 - 2.1 + isl.z * 0.01);
      const ridged = 1 - Math.abs(2 * n2 - 1);
      const relief = ((n1 - 0.45) * 40 + (ridged - 0.55) * 24 + (n2 - 0.5) * 12)
        * Math.min(1, t * 2.2);
      h = Math.max(h, dome + relief - 6);
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

// Smoothstep helper for blending terrain color bands without hard steps.
function smoothstep(a, b, v) {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// patch: 0..1 noise value for patchiness (dry grass, scrub variation).
function colorForHeight(h, slope, patch) {
  const wetSand = new THREE.Color(0xc9a86a);
  const sand = new THREE.Color(0xe8d29a);
  const grass = new THREE.Color(0x57a84e);
  const dryGrass = new THREE.Color(0x8fa653);
  const scrub = new THREE.Color(0x7d9b52);
  const rock = new THREE.Color(0x9a9a9a);
  const cliff = new THREE.Color(0x8a7a68);

  const c = wetSand.clone();
  c.lerp(sand, smoothstep(0.3, 1.4, h));          // wet band -> pale sand
  c.lerp(grass, smoothstep(1.8, 4.5, h));         // shore -> green
  // Dry-grass patches scattered through the green by noise.
  c.lerp(dryGrass, smoothstep(0.55, 0.8, patch) * smoothstep(3, 10, h) * 0.8);
  c.lerp(scrub, smoothstep(34, 48, h));           // higher scrub
  c.lerp(rock, smoothstep(62, 80, h));            // grey peaks
  // Steep slopes go rocky at any height.
  c.lerp(cliff, smoothstep(0.32, 0.62, slope) * 0.75);
  // Gentle patchiness so big flat areas don't read as one flat color.
  const shade = 0.94 + patch * 0.12;
  c.r *= shade; c.g *= shade; c.b *= shade;
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
    const patch = noiseFn(pos.getX(i) * 0.02 + 31, pos.getZ(i) * 0.02 - 17);
    const c = colorForHeight(h, slope, patch);
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
  scene.add(buildAirport());
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

// Airport detail near the home runway: control tower, low terminal with an
// arched roof, and two parked airliners. Cheap low-poly geometry; it mainly
// needs to read in low passes and the panorama.
function buildAirport() {
  const group = new THREE.Group();
  const concrete = new THREE.MeshLambertMaterial({ color: 0xb8bcc0 });
  const glass = new THREE.MeshPhongMaterial({ color: 0x9fd8ff, shininess: 120, specular: 0xffffff });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x5a6a7d });
  const white = new THREE.MeshLambertMaterial({ color: 0xf4f6f8 });
  const blue = new THREE.MeshLambertMaterial({ color: 0x2f6fd1 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x3a3f46 });

  // Control tower: tapered shaft + glass cab + flat roof.
  const tower = new THREE.Group();
  const tx = 75, tz = -50, tBase = heightAt(tx, tz);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 8.5, 40, 10), concrete);
  shaft.position.y = 20;
  tower.add(shaft);
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 8, 7, 10), glass);
  cab.position.y = 43.5;
  tower.add(cab);
  const cabRoof = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 1.6, 10), roofMat);
  cabRoof.position.y = 47.8;
  tower.add(cabRoof);
  tower.position.set(tx, tBase, tz);
  group.add(tower);

  // Terminal: long low box, half-cylinder arched roof, lit window strip.
  const terminal = new THREE.Group();
  const ex = 110, ez = 200, eBase = heightAt(ex, ez);
  const body = new THREE.Mesh(new THREE.BoxGeometry(95, 13, 26), concrete);
  body.position.y = 6.5;
  terminal.add(body);
  const arch = new THREE.Mesh(
    new THREE.CylinderGeometry(13, 13, 95, 12, 1, false, 0, Math.PI), roofMat);
  arch.rotation.z = Math.PI / 2;
  arch.rotation.y = Math.PI / 2;
  arch.position.y = 13;
  terminal.add(arch);
  const windows = new THREE.Mesh(
    new THREE.BoxGeometry(88, 4.5, 0.6),
    new THREE.MeshBasicMaterial({ color: 0xffd75e }));
  windows.position.set(0, 7, -13.3);
  terminal.add(windows);
  terminal.position.set(ex, eBase, ez);
  group.add(terminal);

  // Parked airliner: fuselage cylinder + nose, wing, tail fin, two engines.
  const buildPlane = (px, pz, heading) => {
    const plane = new THREE.Group();
    const fus = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 34, 10), white);
    fus.rotation.x = Math.PI / 2;
    fus.position.y = 4.2;
    plane.add(fus);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(3, 10, 8), white);
    nose.scale.set(1, 1, 1.6);
    nose.position.set(0, 4.2, -17);
    plane.add(nose);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(30, 0.8, 6), white);
    wing.position.set(0, 3.6, 1);
    plane.add(wing);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8, 5), blue);
    tail.position.set(0, 8.5, 15.5);
    plane.add(tail);
    const stab = new THREE.Mesh(new THREE.BoxGeometry(11, 0.7, 3.5), white);
    stab.position.set(0, 5.6, 16);
    plane.add(stab);
    for (const side of [-1, 1]) {
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 4.5, 8), dark);
      eng.rotation.x = Math.PI / 2;
      eng.position.set(side * 7.5, 2.2, -1);
      plane.add(eng);
    }
    plane.position.set(px, heightAt(px, pz), pz);
    plane.rotation.y = heading;
    return plane;
  };
  group.add(buildPlane(65, 150, 0.15));
  group.add(buildPlane(85, 255, -0.1));
  return group;
}

function buildTrees() {
  const rng = mulberry32(worldSeed * 101 + 3);
  const trunkGeo = new THREE.CylinderGeometry(1.1, 1.5, 7, 6);
  const coneGeo = new THREE.ConeGeometry(6.5, 17, 8);          // pine
  const roundGeo = new THREE.SphereGeometry(6.8, 8, 6);        // round canopy
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
  const pineMat = new THREE.MeshLambertMaterial({ color: 0x2f7d3a });
  const roundMat = new THREE.MeshLambertMaterial({ color: 0x4a9e46 });
  const COUNT = 650;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, COUNT);
  const pines = new THREE.InstancedMesh(coneGeo, pineMat, COUNT);
  const rounds = new THREE.InstancedMesh(roundGeo, roundMat, COUNT);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  let placed = 0, pineCount = 0, roundCount = 0;
  let guard = 0;
  while (placed < COUNT && guard < COUNT * 40) {
    guard++;
    const isl = ISLANDS[Math.floor(rng() * ISLANDS.length)];
    const ang = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * isl.r * 0.92;
    const x = isl.x + Math.cos(ang) * rad;
    const z = isl.z + Math.sin(ang) * rad;
    const h = heightAt(x, z);
    // Dense on the lower slopes, thinning out higher up.
    if (h < 2 || h > 55) continue;
    if (h > 35 && rng() < 0.65) continue;
    // Skip steep ground: estimate slope from nearby samples.
    const slopeEst = Math.max(
      Math.abs(heightAt(x + 7, z) - h), Math.abs(heightAt(x - 7, z) - h),
      Math.abs(heightAt(x, z + 7) - h), Math.abs(heightAt(x, z - 7) - h));
    if (slopeEst > 4.2) continue;
    let onRunway = false;
    for (const rw of RUNWAYS) {
      const { lx, lz } = runwayLocal(x, z, rw);
      if (Math.abs(lx) < rw.width && Math.abs(lz) < rw.length / 2 + 40) onRunway = true;
    }
    if (onRunway) continue;
    const s = 0.7 + rng() * 1.0;
    e.set(0, rng() * Math.PI * 2, 0);
    q.setFromEuler(e);
    v.set(x, h + 3.2 * s, z); sc.set(s, s, s);
    m.compose(v, q, sc);
    trunks.setMatrixAt(placed, m);
    if (rng() < 0.6) {
      v.set(x, h + 15 * s, z);
      m.compose(v, q, sc);
      pines.setMatrixAt(pineCount++, m);
    } else {
      v.set(x, h + 11 * s, z); sc.set(s, s * 0.82, s);
      m.compose(v, q, sc);
      rounds.setMatrixAt(roundCount++, m);
    }
    placed++;
  }
  trunks.count = placed;
  pines.count = pineCount;
  rounds.count = roundCount;
  const group = new THREE.Group();
  group.add(trunks, pines, rounds);
  return group;
}
