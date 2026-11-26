// terrain.js — seeded archipelago heightfield, water, runways, town, trees,
// bushes, ground detail (fields, roads, scattered houses) and distant
// layered mountain ranges.
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

// Water mesh state, filled in by buildTerrain so updateWater can animate
// the surface without rebuilding geometry.
let waterMesh = null;
let waterBase = null;
let waterMat = null;

// Gentle two-sine wave field on the water plane plus a slow shininess
// shimmer for sun glitter. Normals are left alone to keep it cheap.
export function updateWater(timeSeconds) {
  if (!waterMesh) return;
  const pos = waterMesh.geometry.attributes.position;
  const arr = pos.array;
  const t = timeSeconds;
  for (let i = 0; i < pos.count; i++) {
    const x = waterBase[i * 3];
    const z = waterBase[i * 3 + 2];
    arr[i * 3 + 1] = 0.18 * Math.sin(x * (Math.PI * 2 / 200) + t * 0.6)
      + 0.12 * Math.sin(z * (Math.PI * 2 / 110) + t * 0.9);
  }
  pos.needsUpdate = true;
  waterMat.shininess = 90 + Math.sin(t * 0.7) * 18;
}

// Raw island height before runway flattening. Three noise octaves plus a
// ridged component (1-|n|) give hills and crests instead of one smooth dome;
// the fine third octave adds small-scale surface texture.
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
      const n3 = noiseFn(x * 0.03 + 19.7 + isl.x * 0.01, z * 0.03 - 11.3 + isl.z * 0.01);
      const ridged = 1 - Math.abs(2 * n2 - 1);
      // Very-low-frequency swell so islands have broad contour variety
      // (shoulders, bays, secondary rises) beyond one smooth dome.
      const swell = (noiseFn(x * 0.0016 + isl.x * 0.01, z * 0.0016 + isl.z * 0.01) - 0.5)
        * 18 * Math.min(1, t * 1.6);
      // Ridged relief grows toward the high ground so crests read sharper.
      const ridgedAmp = 34 + 16 * Math.pow(t, 1.5);
      const relief = ((n1 - 0.45) * 40 + (ridged - 0.55) * ridgedAmp + (n2 - 0.5) * 12
        + (n3 - 0.5) * 10) * Math.min(1, t * 2.2);
      h = Math.max(h, dome + swell + relief - 6);
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
// fine: 0..1 finer noise for small-scale light/dark grass patchwork.
function colorForHeight(h, slope, patch, fine) {
  const wetSand = new THREE.Color(0xc9a86a);
  const sand = new THREE.Color(0xe8d29a);
  const grass = new THREE.Color(0x57a84e);
  const lush = new THREE.Color(0x3c8a3e);
  const lightGrass = new THREE.Color(0x71c05a);
  const dryGrass = new THREE.Color(0x8fa653);
  const scrub = new THREE.Color(0x7d9b52);
  const rock = new THREE.Color(0x9a9a9a);
  const cliff = new THREE.Color(0x8a7a68);

  const duneGrass = new THREE.Color(0xa8c86e);
  const c = wetSand.clone();
  c.lerp(sand, smoothstep(0.4, 2.2, h));          // wide wet band -> pale sand
  // Dune-grass transition between sand and grass, speckled by fine noise
  // so the shoreline is a broken band rather than a hard ring.
  const speckle = (fine - 0.5) * 1.8;
  c.lerp(duneGrass, smoothstep(1.6 + speckle * 0.5, 3.4 + speckle * 0.5, h) * 0.85);
  c.lerp(grass, smoothstep(2.6 + speckle, 5.4 + speckle, h));  // shore -> green
  // Darker lush green in the low band just above the sand.
  c.lerp(lush, smoothstep(2.2, 5, h) * (1 - smoothstep(9, 20, h)) * 0.6);
  // Fine light/dark patchwork across the grass band.
  const grassBand = smoothstep(2.5, 5, h) * (1 - smoothstep(45, 62, h));
  c.lerp(lightGrass, smoothstep(0.55, 0.85, fine) * grassBand * 0.5);
  c.lerp(lush, (1 - smoothstep(0.15, 0.45, fine)) * grassBand * 0.4);
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
  const SEG = 200;
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
    const fine = noiseFn(pos.getX(i) * 0.06 + 53, pos.getZ(i) * 0.06 + 27);
    const c = colorForHeight(h, slope, patch, fine);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(mesh);

  // Water plane (wide enough to reach the far mountain ring at ~4600),
  // vertex-colored by depth so shallows read turquoise and the open sea
  // deepens to dark blue. Segmented so updateWater can displace waves.
  const waterGeo = new THREE.PlaneGeometry(11000, 11000, 96, 96);
  waterGeo.rotateX(-Math.PI / 2);
  const wPos = waterGeo.attributes.position;
  const wColors = new Float32Array(wPos.count * 3);
  const cPale = new THREE.Color(0x8fe0cf);
  const cShallow = new THREE.Color(0x35aec9);
  const cMid = new THREE.Color(0x1f7fb8);
  const cDeep = new THREE.Color(0x155a94);
  for (let i = 0; i < wPos.count; i++) {
    const depth = -heightAt(wPos.getX(i), wPos.getZ(i));
    const c = cPale.clone();
    c.lerp(cShallow, smoothstep(0.5, 6, depth));
    c.lerp(cMid, smoothstep(6, 14, depth));
    c.lerp(cDeep, smoothstep(14, 30, depth));
    wColors[i * 3] = c.r; wColors[i * 3 + 1] = c.g; wColors[i * 3 + 2] = c.b;
  }
  waterGeo.setAttribute("color", new THREE.BufferAttribute(wColors, 3));
  waterMat = new THREE.MeshPhongMaterial({
    vertexColors: true, shininess: 90, specular: 0x99d9ff,
    transparent: true, opacity: 0.94
  });
  waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.position.y = 0;
  waterBase = new Float32Array(wPos.array);
  scene.add(waterMesh);

  for (const rw of RUNWAYS) scene.add(buildRunway(rw));
  scene.add(buildTown());
  scene.add(buildAirport());
  scene.add(buildTrees());
  scene.add(buildBushes());
  scene.add(buildRocks());
  buildMountainRings(scene);
  buildDistantIslands(scene);
  buildGroundDetail(scene);
  return mesh;
}

// Concentric jagged ridge rings far beyond the play area. Each ring is a
// vertical band whose top edge is noise-displaced; hazy flat colors plus
// scene fog make them read as layered atmospheric silhouettes.
function buildMountainRings(scene) {
  const rings = [
    { radius: 3000, minH: 250, maxH: 450, color: 0x6f93b4, seedX: 41.2, seedZ: 8.6 },
    { radius: 3800, minH: 350, maxH: 550, color: 0x8cabc6, seedX: 97.5, seedZ: 63.1 },
    { radius: 4600, minH: 450, maxH: 750, color: 0xa9c2d8, seedX: 152.8, seedZ: 121.4 }
  ];
  const SEGMENTS = 224;
  for (const ring of rings) {
    const positions = new Float32Array((SEGMENTS + 1) * 2 * 3);
    const indices = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      // Trace a circle through noise space so the ridge wraps seamlessly.
      const n = noiseFn(ring.seedX + ca * 2.3, ring.seedZ + sa * 2.3) * 0.6
        + noiseFn(ring.seedX * 1.7 + ca * 5.6, ring.seedZ * 1.7 + sa * 5.6) * 0.4;
      const ridged = 1 - Math.abs(2 * n - 1);
      const shaped = Math.pow(n * 0.4 + ridged * 0.6, 1.25);
      const peak = ring.minH + shaped * (ring.maxH - ring.minH);
      const wobble = (noiseFn(ring.seedX * 0.6 + ca * 1.4, ring.seedZ * 0.6 + sa * 1.4) - 0.5) * 300;
      const r = ring.radius + wobble;
      const x = ca * r, z = sa * r;
      const vi = i * 2 * 3;
      positions[vi] = x; positions[vi + 1] = -20; positions[vi + 2] = z;
      positions[vi + 3] = x; positions[vi + 4] = peak; positions[vi + 5] = z;
      if (i < SEGMENTS) {
        const b0 = i * 2, t0 = i * 2 + 1, b1 = i * 2 + 2, t1 = i * 2 + 3;
        indices.push(b0, b1, t0, t0, b1, t1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    const mat = new THREE.MeshBasicMaterial({
      color: ring.color, fog: true, side: THREE.DoubleSide
    });
    scene.add(new THREE.Mesh(geo, mat));
  }
}

// A handful of low hazy island silhouettes between the play area and the
// first mountain ring, for mid-distance depth.
function buildDistantIslands(scene) {
  const rng = mulberry32(worldSeed * 733 + 19);
  const mat = new THREE.MeshBasicMaterial({ color: 0x7fa08e, fog: true });
  const COUNT = 5;
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2 + rng() * 0.8;
    const dist = 2600 + rng() * 300;
    const radius = 320 + rng() * 260;
    const height = 55 + rng() * 70;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 7), mat);
    cone.position.set(Math.cos(a) * dist, height / 2 - 14, Math.sin(a) * dist);
    cone.scale.set(1, 1, 0.6 + rng() * 0.5);
    cone.rotation.y = rng() * Math.PI * 2;
    scene.add(cone);
  }
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
  const roofMats = [0xb0503c, 0x8a4a3a, 0x6b7a8c, 0xa86a44].map(
    (c) => new THREE.MeshLambertMaterial({ color: c }));
  const parapetMat = new THREE.MeshLambertMaterial({ color: 0x5d5648 });
  const litMat = new THREE.MeshBasicMaterial({ color: 0xffd75e });
  const darkGlassMat = new THREE.MeshBasicMaterial({ color: 0x33566b });
  const winGeo = new THREE.PlaneGeometry(2.6, 2.6);
  // Unit triangular prism for gable roofs: cylinder axis laid along X,
  // apex up, base spanning z -0.866..0.866 at y=-0.5, ridge at y=1.
  const gableGeo = new THREE.CylinderGeometry(1, 1, 1, 3);
  gableGeo.rotateZ(Math.PI / 2);
  gableGeo.rotateX(-Math.PI / 2);

  for (let i = 0; i < 42; i++) {
    const gx = 150 + (i % 7) * 52 + rng() * 18;
    const gz = -160 + Math.floor(i / 7) * 58 + rng() * 18;
    const h = 12 + Math.pow(rng(), 1.6) * 44;
    const w = 20 + rng() * 14;
    const d = 20 + rng() * 14;
    const base = heightAt(gx, gz);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color: wallColors[i % wallColors.length] })
    );
    body.position.set(gx, base + h / 2, gz);
    group.add(body);

    // Roof variety: pyramid, gable prism, or flat slab with parapet.
    const roofMat = roofMats[Math.floor(rng() * roofMats.length)];
    const roofPick = rng();
    if (roofPick < 0.4) {
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, 8, 4), roofMat);
      roof.position.set(gx, base + h + 4, gz);
      roof.rotation.y = Math.PI / 4;
      group.add(roof);
    } else if (roofPick < 0.75) {
      const longSide = Math.max(w, d) * 1.04;
      const shortSide = Math.min(w, d) * 1.04;
      const roofH = 5 + rng() * 3;
      const sy = roofH / 1.5;
      const roof = new THREE.Mesh(gableGeo, roofMat);
      roof.scale.set(longSide, sy, shortSide / 1.732);
      roof.position.set(gx, base + h + 0.5 * sy, gz);
      if (d > w) roof.rotation.y = Math.PI / 2;
      group.add(roof);
    } else {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w * 1.06, 1.6, d * 1.06), parapetMat);
      slab.position.set(gx, base + h + 0.8, gz);
      group.add(slab);
    }

    // Windows on the west and south faces, lit or dark by chance.
    const floors = Math.max(1, Math.floor(h / 7));
    const cols = 2 + Math.floor(rng() * 2);
    for (let f = 0; f < floors; f++) {
      const wy = base + 4.5 + f * 7;
      if (wy > base + h - 2) break;
      for (let cIdx = 0; cIdx < cols; cIdx++) {
        const t = cols === 1 ? 0 : cIdx / (cols - 1) - 0.5;
        const winW = new THREE.Mesh(winGeo, rng() < 0.55 ? litMat : darkGlassMat);
        winW.position.set(gx - w / 2 - 0.15, wy, gz + t * d * 0.62);
        winW.rotation.y = -Math.PI / 2;
        group.add(winW);
        const winS = new THREE.Mesh(winGeo, rng() < 0.55 ? litMat : darkGlassMat);
        winS.position.set(gx + t * w * 0.62, wy, gz + d / 2 + 0.15);
        group.add(winS);
      }
    }
  }

  // Simple street strips draped over the terrain inside the town grid:
  // two east-west streets between building rows and one north-south
  // street running south toward the airport side.
  const streetMat = new THREE.MeshLambertMaterial({
    color: 0x45484e, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  });
  const addStreet = (points) => {
    for (let p = 0; p < points.length - 1; p++) {
      const ax = points[p][0], az = points[p][1];
      const bx = points[p + 1][0], bz = points[p + 1][1];
      const legLen = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.round(legLen / 30));
      for (let s = 0; s < steps; s++) {
        const t0 = s / steps, t1 = (s + 1) / steps;
        const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0;
        const x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        const h0 = heightAt(x0, z0), h1 = heightAt(x1, z1);
        const segLen = Math.hypot(x1 - x0, z1 - z0) + 1.5;
        const geo = new THREE.PlaneGeometry(7, segLen);
        geo.rotateX(-Math.PI / 2);
        const seg = new THREE.Mesh(geo, streetMat);
        seg.position.set(mx, (h0 + h1) / 2 + 0.25, mz);
        const yaw = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0), Math.atan2(x1 - x0, z1 - z0));
        const pitch = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(1, 0, 0), -Math.atan2(h1 - h0, segLen));
        seg.quaternion.copy(yaw).multiply(pitch);
        group.add(seg);
      }
    }
  };
  addStreet([[140, -102], [320, -102], [500, -102]]);
  addStreet([[140, 14], [320, 14], [500, 14]]);
  addStreet([[306, -170], [306, 20], [306, 215]]);
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
  const broadGeo = new THREE.SphereGeometry(6.8, 8, 6);        // broadleaf canopy
  broadGeo.scale(1.3, 0.75, 1.3);
  // Palm trunk: cylinder bent so the lean grows with height.
  const palmTrunkGeo = new THREE.CylinderGeometry(0.9, 1.4, 11, 6);
  {
    const p = palmTrunkGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) + 5.5) / 11;
      p.setX(i, p.getX(i) + t * t * 2.2);
    }
    palmTrunkGeo.computeVertexNormals();
  }
  const palmCrownGeo = new THREE.ConeGeometry(5.2, 2.4, 8);    // flattened palm crown
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5230 });
  const pineMat = new THREE.MeshLambertMaterial({ color: 0x2f7d3a });
  const roundMat = new THREE.MeshLambertMaterial({ color: 0x4a9e46 });
  const broadMat = new THREE.MeshLambertMaterial({ color: 0x357a33 });
  const palmMat = new THREE.MeshLambertMaterial({ color: 0x3f9e4d });
  const COUNT = 1000;
  const PALM_COUNT = 120;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, COUNT);
  const pines = new THREE.InstancedMesh(coneGeo, pineMat, COUNT);
  const rounds = new THREE.InstancedMesh(roundGeo, roundMat, COUNT);
  const broads = new THREE.InstancedMesh(broadGeo, broadMat, COUNT);
  const palmTrunks = new THREE.InstancedMesh(palmTrunkGeo, trunkMat, PALM_COUNT);
  const palmCrowns = new THREE.InstancedMesh(palmCrownGeo, palmMat, PALM_COUNT);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const col = new THREE.Color();
  // Per-instance brightness jitter so canopies are not identical clones.
  const jitter = (mesh, idx) => {
    const b = 0.85 + rng() * 0.25;
    col.setRGB(b, b * (0.95 + rng() * 0.1), b * (0.9 + rng() * 0.1));
    mesh.setColorAt(idx, col);
  };
  let placed = 0, pineCount = 0, roundCount = 0, broadCount = 0;
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
    const yaw = rng() * Math.PI * 2;
    e.set(0, yaw, 0);
    q.setFromEuler(e);
    const pick = rng();
    if (pick < 0.45) {
      v.set(x, h + 3.2 * s, z); sc.set(s, s, s);
      m.compose(v, q, sc);
      trunks.setMatrixAt(placed, m);
      v.set(x, h + 15 * s, z);
      m.compose(v, q, sc);
      pines.setMatrixAt(pineCount, m);
      jitter(pines, pineCount);
      pineCount++;
    } else if (pick < 0.75) {
      v.set(x, h + 3.2 * s, z); sc.set(s, s, s);
      m.compose(v, q, sc);
      trunks.setMatrixAt(placed, m);
      v.set(x, h + 11 * s, z); sc.set(s, s * 0.82, s);
      m.compose(v, q, sc);
      rounds.setMatrixAt(roundCount, m);
      jitter(rounds, roundCount);
      roundCount++;
    } else {
      // Broadleaf: taller trunk, wide flattened deep-green canopy.
      v.set(x, h + 3.2 * s * 1.5, z); sc.set(s, s * 1.5, s);
      m.compose(v, q, sc);
      trunks.setMatrixAt(placed, m);
      v.set(x, h + 15 * s, z); sc.set(s, s, s);
      m.compose(v, q, sc);
      broads.setMatrixAt(broadCount, m);
      jitter(broads, broadCount);
      broadCount++;
    }
    placed++;
  }
  trunks.count = placed;
  pines.count = pineCount;
  rounds.count = roundCount;
  broads.count = broadCount;

  // Palms: beach fringe only, low ground just above the waterline.
  let palmsPlaced = 0;
  let palmGuard = 0;
  while (palmsPlaced < PALM_COUNT && palmGuard < PALM_COUNT * 80) {
    palmGuard++;
    const isl = ISLANDS[Math.floor(rng() * ISLANDS.length)];
    const ang = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * isl.r * 0.98;
    const x = isl.x + Math.cos(ang) * rad;
    const z = isl.z + Math.sin(ang) * rad;
    const h = heightAt(x, z);
    if (h < 1.2 || h > 5.5) continue;
    const slopeEst = Math.max(
      Math.abs(heightAt(x + 7, z) - h), Math.abs(heightAt(x - 7, z) - h),
      Math.abs(heightAt(x, z + 7) - h), Math.abs(heightAt(x, z - 7) - h));
    if (slopeEst > 3.5) continue;
    let onRunway = false;
    for (const rw of RUNWAYS) {
      const { lx, lz } = runwayLocal(x, z, rw);
      if (Math.abs(lx) < rw.width && Math.abs(lz) < rw.length / 2 + 40) onRunway = true;
    }
    if (onRunway) continue;
    const s = 0.8 + rng() * 0.5;
    const yaw = rng() * Math.PI * 2;
    e.set(0, yaw, 0);
    q.setFromEuler(e);
    v.set(x, h + 5.2 * s, z); sc.set(s, s, s);
    m.compose(v, q, sc);
    palmTrunks.setMatrixAt(palmsPlaced, m);
    // Crown follows the baked-in lean (2.2 units at the top, rotated by yaw).
    v.set(x + Math.cos(yaw) * 2.2 * s, h + 10.6 * s, z - Math.sin(yaw) * 2.2 * s);
    sc.set(s, s * 0.8, s);
    m.compose(v, q, sc);
    palmCrowns.setMatrixAt(palmsPlaced, m);
    jitter(palmCrowns, palmsPlaced);
    palmsPlaced++;
  }
  palmTrunks.count = palmsPlaced;
  palmCrowns.count = palmsPlaced;

  for (const mesh of [pines, rounds, broads, palmCrowns]) {
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  const group = new THREE.Group();
  group.add(trunks, pines, rounds, broads, palmTrunks, palmCrowns);
  return group;
}

// Scattered boulders on land and a few at the shoreline, sunk partway
// into the ground. Same runway/town exclusion style as the trees.
function buildRocks() {
  const rng = mulberry32(worldSeed * 409 + 29);
  const geo = new THREE.DodecahedronGeometry(1.7, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0x8d8d8d });
  const COUNT = 250;
  const rocks = new THREE.InstancedMesh(geo, mat, COUNT);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  let placed = 0;
  let guard = 0;
  while (placed < COUNT && guard < COUNT * 60) {
    guard++;
    const isl = ISLANDS[Math.floor(rng() * ISLANDS.length)];
    const ang = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * isl.r * 0.98;
    const x = isl.x + Math.cos(ang) * rad;
    const z = isl.z + Math.sin(ang) * rad;
    const h = heightAt(x, z);
    // Mostly on land, a few right at the shoreline.
    if (h < -0.5 || h > 65) continue;
    if (h < 0.5 && rng() < 0.7) continue;
    if (insideRunway(x, z, 6)) continue;
    if (insideTownOrAirport(x, z)) continue;
    const sx = 0.6 + rng() * 1.6;
    const sy = 0.6 + rng() * 1.6;
    const sz = 0.6 + rng() * 1.6;
    e.set(rng() * Math.PI, rng() * Math.PI * 2, rng() * Math.PI);
    q.setFromEuler(e);
    v.set(x, h + 1.7 * sy * 0.55, z);
    sc.set(sx, sy, sz);
    m.compose(v, q, sc);
    rocks.setMatrixAt(placed, m);
    placed++;
  }
  rocks.count = placed;
  return rocks;
}

// Low squashed-sphere bushes scattered on gentle low slopes, in varied
// dark greens. Same runway exclusion as the trees.
function buildBushes() {
  const rng = mulberry32(worldSeed * 307 + 11);
  const geo = new THREE.SphereGeometry(1, 7, 5);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const COUNT = 700;
  const bushes = new THREE.InstancedMesh(geo, mat, COUNT);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const col = new THREE.Color();
  const greens = [0x2e6e33, 0x3a7d3a, 0x2a6330, 0x478a3c, 0x356b2e];
  let placed = 0;
  let guard = 0;
  while (placed < COUNT && guard < COUNT * 40) {
    guard++;
    const isl = ISLANDS[Math.floor(rng() * ISLANDS.length)];
    const ang = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * isl.r * 0.94;
    const x = isl.x + Math.cos(ang) * rad;
    const z = isl.z + Math.sin(ang) * rad;
    const h = heightAt(x, z);
    if (h < 2 || h > 30) continue;
    // Gentle slopes only.
    const slopeEst = Math.max(
      Math.abs(heightAt(x + 6, z) - h), Math.abs(heightAt(x - 6, z) - h),
      Math.abs(heightAt(x, z + 6) - h), Math.abs(heightAt(x, z - 6) - h));
    if (slopeEst > 3) continue;
    let onRunway = false;
    for (const rw of RUNWAYS) {
      const { lx, lz } = runwayLocal(x, z, rw);
      if (Math.abs(lx) < rw.width && Math.abs(lz) < rw.length / 2 + 40) onRunway = true;
    }
    if (onRunway) continue;
    const r = 2.5 + rng() * 1.5;
    e.set(0, rng() * Math.PI * 2, 0);
    q.setFromEuler(e);
    v.set(x, h + r * 0.45, z);
    sc.set(r, r * 0.55, r);
    m.compose(v, q, sc);
    bushes.setMatrixAt(placed, m);
    col.setHex(greens[Math.floor(rng() * greens.length)]);
    bushes.setColorAt(placed, col);
    placed++;
  }
  bushes.count = placed;
  if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;
  return bushes;
}

// Slope estimate for the ground-detail scatter: largest height difference
// to four neighbours `step` units away (same idea as buildTrees).
function slopeEstimate(x, z, h, step) {
  return Math.max(
    Math.abs(heightAt(x + step, z) - h), Math.abs(heightAt(x - step, z) - h),
    Math.abs(heightAt(x, z + step) - h), Math.abs(heightAt(x, z - step) - h));
}

// True when (x, z) lies inside any runway rectangle grown by `margin`.
function insideRunway(x, z, margin) {
  for (const rw of RUNWAYS) {
    const { lx, lz } = runwayLocal(x, z, rw);
    if (Math.abs(lx) < rw.width / 2 + margin && Math.abs(lz) < rw.length / 2 + margin) {
      return true;
    }
  }
  return false;
}

// Town grid (gx 150-510, gz -160..190) and airport buildings
// (x 65..158, z -50..272), each grown by roughly 70 units so scattered
// detail does not collide with the built-up areas.
function insideTownOrAirport(x, z) {
  if (x > 80 && x < 580 && z > -230 && z < 260) return true;   // town + margin
  if (x > -5 && x < 228 && z > -120 && z < 342) return true;   // airport + margin
  return false;
}

// Dense ground detail around the runways so low passes and the approach
// read as inhabited farmland: flat field patches, a few short roads and
// scattered houses. Everything is placed from one seeded RNG stream.
function buildGroundDetail(scene) {
  const rng = mulberry32(worldSeed * 521 + 23);
  const group = new THREE.Group();

  // --- Fields: flat rectangular farmland patches on gentle low ground.
  const fieldColors = [0x6fae4e, 0x8fa653, 0xb5a05a, 0x7a9a4a, 0x9c8a5a];
  const FIELD_COUNT = 36;
  let fieldsPlaced = 0;
  let fieldGuard = 0;
  while (fieldsPlaced < FIELD_COUNT && fieldGuard < FIELD_COUNT * 60) {
    fieldGuard++;
    // Concentrate near the Home Runway lowlands, spread some across
    // Home Island, and put a few around the Far Strip.
    let x, z;
    const pick = rng();
    if (pick < 0.5) {
      x = (rng() * 2 - 1) * 460;
      z = -420 + rng() * 1270;           // -420..850, biased to the approach side
    } else if (pick < 0.8) {
      const ang = rng() * Math.PI * 2;
      const rad = Math.sqrt(rng()) * 830;
      x = Math.cos(ang) * rad;
      z = Math.sin(ang) * rad;
    } else {
      const ang = rng() * Math.PI * 2;
      const rad = 140 + Math.sqrt(rng()) * 330;
      x = 1500 + Math.cos(ang) * rad;
      z = -1050 + Math.sin(ang) * rad;
    }
    const h = heightAt(x, z);
    if (h < 1.5 || h > 22) continue;
    if (slopeEstimate(x, z, h, 7) > 3.2) continue;
    const w = 30 + rng() * 60;
    const d = 30 + rng() * 60;
    const halfDiag = Math.sqrt(w * w + d * d) / 2;
    if (insideRunway(x, z, 18 + halfDiag * 0.45)) continue;
    if (insideTownOrAirport(x, z)) continue;
    // Corners must stay close to the centre height so the flat patch
    // does not float above or bury itself in a slope.
    let cornersOk = true;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        if (Math.abs(heightAt(x + sx * w * 0.38, z + sz * d * 0.38) - h) > 4.5) {
          cornersOk = false;
        }
      }
    }
    if (!cornersOk) continue;
    const col = new THREE.Color(fieldColors[Math.floor(rng() * fieldColors.length)]);
    col.multiplyScalar(0.92 + rng() * 0.16);
    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);
    const field = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      color: col, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
    }));
    field.position.set(x, h + 0.3, z);
    field.rotation.y = rng() * Math.PI;
    group.add(field);
    fieldsPlaced++;
  }

  // --- Roads: short dark-grey segments draped between waypoints.
  const roadMat = new THREE.MeshLambertMaterial({
    color: 0x4a4d52, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
  });
  const roadPaths = [
    // Town west edge -> airport terminal.
    [[215, 5], [165, 85], [128, 175]],
    // Airport apron -> east side of the Home Runway south threshold.
    [[95, 245], [68, 300], [34, 338]],
    // Coast road south of the runway, passing under the approach path.
    [[-430, 515], [-210, 552], [0, 532], [215, 558], [430, 512]]
  ];
  for (const path of roadPaths) {
    for (let p = 0; p < path.length - 1; p++) {
      const ax = path[p][0], az = path[p][1];
      const bx = path[p + 1][0], bz = path[p + 1][1];
      const legLen = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.round(legLen / 30));
      for (let s = 0; s < steps; s++) {
        const t0 = s / steps, t1 = (s + 1) / steps;
        const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0;
        const x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        const h0 = heightAt(x0, z0), h1 = heightAt(x1, z1);
        if (h0 < 0.8 || h1 < 0.8) continue;        // stay out of the water
        if (insideRunway(mx, mz, 2)) continue;     // never paint over the strip
        const segLen = Math.hypot(x1 - x0, z1 - z0) + 1.5;
        const geo = new THREE.PlaneGeometry(6, segLen);
        geo.rotateX(-Math.PI / 2);
        const seg = new THREE.Mesh(geo, roadMat);
        seg.position.set(mx, (h0 + h1) / 2 + 0.25, mz);
        // Yaw onto the path direction, then pitch to match the slope
        // between the segment ends so it hugs the ground.
        const yaw = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0), Math.atan2(x1 - x0, z1 - z0));
        const pitch = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(1, 0, 0), -Math.atan2(h1 - h0, segLen));
        seg.quaternion.copy(yaw).multiply(pitch);
        group.add(seg);
      }
    }
  }

  // --- Scattered houses: same box + cone-roof style as the town, strung
  // along the Home Runway approach path with a few near the Far Strip.
  const wallColors = [0xf2e3c8, 0xe8b4a0, 0xbcd3e8, 0xf7f0dd, 0xd9e6c3];
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xb0503c });
  const HOUSE_COUNT = 18;
  let housesPlaced = 0;
  let houseGuard = 0;
  while (housesPlaced < HOUSE_COUNT && houseGuard < HOUSE_COUNT * 80) {
    houseGuard++;
    let x, z;
    if (housesPlaced < 13) {
      // South of Home Runway, either side of the approach centreline.
      x = (rng() * 2 - 1) * 350;
      z = 380 + rng() * 420;
    } else {
      const ang = rng() * Math.PI * 2;
      const rad = 130 + Math.sqrt(rng()) * 260;
      x = 1500 + Math.cos(ang) * rad;
      z = -1050 + Math.sin(ang) * rad;
    }
    const h = heightAt(x, z);
    if (h < 2 || h > 26) continue;
    if (slopeEstimate(x, z, h, 7) > 3.2) continue;
    if (insideRunway(x, z, 14)) continue;
    if (insideTownOrAirport(x, z)) continue;
    const w = 10 + rng() * 6;
    const d = 10 + rng() * 6;
    const bh = 7 + rng() * 4;
    const house = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, bh, d),
      new THREE.MeshLambertMaterial({ color: wallColors[Math.floor(rng() * wallColors.length)] }));
    body.position.y = bh / 2;
    house.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, 5, 4), roofMat);
    roof.position.y = bh + 2.5;
    roof.rotation.y = Math.PI / 4;
    house.add(roof);
    house.position.set(x, h, z);
    house.rotation.y = rng() * Math.PI * 2;
    group.add(house);
    housesPlaced++;
  }

  scene.add(group);
}
