// sky.js — sky dome, sun, hemisphere light, fog and low-poly clouds with
// three weather presets: "day" (clear day), "sunset" and "cloudy".
//
// Horizon rule: the fog color is EXACTLY the sky dome's horizon color in
// every preset, and the dome holds that color in a band around y = 0, so
// terrain and ocean fade into the sky with no visible wall or seam.
// Preset changes are instant (no per-frame work): setPreset() rewrites
// the dome vertex colors, fog, lights, sun sprite and cloud count/color.
import * as THREE from "three";

// ---------------------------------------------------------------------------
// Presets. Every value that differs between conditions lives here.
//   top / mid / horizon — sky dome gradient stops (horizon doubles as fog)
//   fogNear / fogFar    — linear fog range (far stays below the ocean
//                         plane half-extent 5500 and the dome radius 6000)
//   sun*                — directional light color / intensity / position
//   hemi*               — hemisphere light sky+ground colors / intensity
//   cloudColor/Count    — cloud material color and visible puff count
//   sprite*             — sun glow sprite scale / opacity / visibility
//   exposure            — renderer tone-mapping exposure for the preset
// ---------------------------------------------------------------------------
const PRESETS = {
  day: {
    top: 0x2f6fd0, mid: 0x7db3e8, horizon: 0xcfe3f2,
    fogNear: 1200, fogFar: 5400,
    sunColor: 0xfff1d6, sunIntensity: 1.35, sunPos: [-900, 1600, -600],
    hemiSky: 0xbfd9ff, hemiGround: 0x8a7a5a, hemiIntensity: 0.75,
    cloudColor: 0xffffff, cloudCount: 90,
    spriteScale: 520, spriteOpacity: 0.8, spriteVisible: true,
    exposure: 1.0
  },
  sunset: {
    top: 0x3d5a99, mid: 0xe88a5a, horizon: 0xf7c489,
    fogNear: 900, fogFar: 5000,
    sunColor: 0xff9a4d, sunIntensity: 1.15, sunPos: [-1600, 380, -1000],
    hemiSky: 0x9db4e0, hemiGround: 0x7a5a40, hemiIntensity: 0.6,
    cloudColor: 0xffdfc0, cloudCount: 115,
    spriteScale: 720, spriteOpacity: 0.9, spriteVisible: true,
    exposure: 0.95
  },
  cloudy: {
    top: 0x7d93a8, mid: 0xa7b8c4, horizon: 0xcad5dd,
    fogNear: 900, fogFar: 4600,
    sunColor: 0xdfe6ea, sunIntensity: 0.85, sunPos: [-600, 1500, -400],
    hemiSky: 0xcad5dd, hemiGround: 0x6a6a62, hemiIntensity: 0.95,
    cloudColor: 0xc2ced6, cloudCount: 150,
    spriteScale: 520, spriteOpacity: 0, spriteVisible: false,
    exposure: 1.05
  }
};

export const SKY_PRESET_NAMES = ["day", "sunset", "cloudy"];

const DOME_RADIUS = 6000;
const CLOUD_TOTAL = 150; // instanced puff capacity (cloudy shows all)

// Deterministic PRNG so the cloud layout is identical on every load.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(a, b, v) {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Sky gradient for a normalized dome height y (-1 at nadir, +1 at zenith).
// The horizon color is held flat from y = -0.02 to y = 0.06 so fogged
// terrain meets an identical color; above that it blends to the mid stop
// by y = 0.22 and to the top stop by y = 0.55. Below the horizon the dome
// darkens gently toward the nadir (only visible looking straight down).
function domeColorAt(y, top, mid, horizon, out) {
  if (y >= 0.06) {
    if (y < 0.22) {
      out.copy(horizon).lerp(mid, smoothstep(0.06, 0.22, y));
    } else {
      out.copy(mid).lerp(top, smoothstep(0.22, 0.55, y));
    }
  } else if (y >= -0.02) {
    out.copy(horizon);
  } else {
    const darken = smoothstep(-0.02, -0.7, y) * 0.25;
    out.copy(horizon).multiplyScalar(1 - darken);
  }
  return out;
}

// Soft radial glow texture for the sun sprite.
function makeGlowTexture() {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, "rgba(255,248,225,1)");
  g.addColorStop(0.3, "rgba(255,232,180,0.8)");
  g.addColorStop(1, "rgba(255,210,140,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Clouds: one InstancedMesh of flattened icosahedrons (detail 1,
// flat-shaded Lambert — the cheapest solid material) gives crisp low-poly
// silhouettes instead of blurry sprites. ~150 puffs in 22 clusters.
// Instances are filled round-robin across clusters, so when a preset
// lowers mesh.count the visible puffs stay spread over the whole sky.
// ---------------------------------------------------------------------------
function createClouds() {
  // Cluster centers: the previous main deck and high layer, plus extra
  // mid-altitude clusters so the cloudy preset has full coverage.
  // Layout notes (Phase 3 cloud notes): the low deck was raised to
  // y 500-560 so clusters sit above typical cruise altitude instead of
  // blocking the landscape, and the cluster that used to sit dead ahead
  // of the southern panorama/aerial viewpoints (300, 560, 1600) moved to
  // the south-west flank (-1400, 660, 1800) so no single cluster fills
  // the frame when the camera is near it. Every center keeps roughly
  // 700+ units from its neighbours for an even spread.
  const clusters = [
    // main deck
    [-900, 520, -600], [700, 540, -1200], [1500, 500, 300], [-1600, 520, 800],
    [-1400, 660, 1800], [-650, 560, 1350], [1900, 540, -900], [-2100, 520, -1400],
    [100, 540, -2000], [1200, 620, 1400],
    // high layer
    [-1300, 760, -300], [900, 820, -1600], [200, 780, 900],
    [-700, 860, 1900], [1700, 720, 1100], [-1900, 800, -1100],
    // extra coverage for cloudy
    [0, 650, -900], [-1200, 600, 200], [800, 550, 700],
    [-300, 720, -1700], [1400, 680, -400], [-1800, 580, -200]
  ];

  const rng = mulberry32(20261126);

  // Puffs per cluster: 5-8 each, nudged so the total is exactly the
  // instanced capacity (the cloudy preset shows every puff).
  const perCluster = clusters.map(() => 5 + Math.floor(rng() * 4));
  let total = perCluster.reduce((a, b) => a + b, 0);
  while (total < CLOUD_TOTAL) {
    const i = Math.floor(rng() * clusters.length);
    if (perCluster[i] < 8) { perCluster[i]++; total++; }
  }
  while (total > CLOUD_TOTAL) {
    const i = Math.floor(rng() * clusters.length);
    if (perCluster[i] > 5) { perCluster[i]--; total--; }
  }

  // One matrix list per cluster; puffs are y-squashed ellipsoids with
  // varied size and orientation, scattered in a flat ellipse.
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const clusterMatrices = clusters.map(([cx, cy, cz], ci) => {
    const list = [];
    for (let i = 0; i < perCluster[ci]; i++) {
      const ox = (rng() * 2 - 1) * 80;
      const oy = (rng() * 2 - 1) * 12;
      const oz = (rng() * 2 - 1) * 50;
      const base = 36 + rng() * 28;             // puff radius 36..64 (~25% smaller)
      const sx = base * (1.0 + rng() * 0.5);
      const sy = base * (0.45 + rng() * 0.15);  // flattened: x0.45..0.60
      const sz = base * (0.75 + rng() * 0.4);
      e.set((rng() * 2 - 1) * 0.25, rng() * Math.PI * 2, (rng() * 2 - 1) * 0.25);
      q.setFromEuler(e);
      v.set(cx + ox, cy + oy, cz + oz);
      sc.set(sx, sy, sz);
      m.compose(v, q, sc);
      list.push(m.clone());
    }
    return list;
  });

  // Interleave: puff 0 of every cluster, then puff 1, and so on. Any
  // prefix of the instance list (a lower preset count) still covers all
  // 22 clusters instead of emptying half the sky.
  const ordered = [];
  const maxPuffs = Math.max(...perCluster);
  for (let r = 0; r < maxPuffs; r++) {
    for (const list of clusterMatrices) {
      if (r < list.length) ordered.push(list[r]);
    }
  }

  const geo = new THREE.IcosahedronGeometry(1, 1);
  // A modest emissive lift (set per preset in setPreset) keeps cloud
  // undersides bright: Lambert undersides otherwise see only the brown
  // hemisphere ground color and read as dark rocks, not clouds.
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x595959, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, CLOUD_TOTAL);
  const tint = new THREE.Color();
  for (let i = 0; i < CLOUD_TOTAL; i++) {
    mesh.setMatrixAt(i, ordered[i]);
    // Subtle per-puff brightness jitter so overlapping puffs read as
    // separate volumes; the preset color multiplies on top.
    const b = 0.88 + rng() * 0.12;
    tint.setRGB(b, b, b);
    mesh.setColorAt(i, tint);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false; // instances span the whole sky
  return mesh;
}

// ---------------------------------------------------------------------------
// createSky(scene, initialPreset, renderer)
// Builds fog, lights, dome, sun sprite and clouds, applies the initial
// preset, and returns { sun, hemi, clouds, setPreset, getPreset }.
// The renderer is optional: when given, setPreset also applies the
// preset's tone-mapping exposure.
// ---------------------------------------------------------------------------
export function createSky(scene, initialPreset = "day", renderer = null) {
  let current = PRESETS[initialPreset] ? initialPreset : "day";

  // Fog is created with the initial preset's horizon color; setPreset
  // keeps fog color === dome horizon color from then on.
  const first = PRESETS[current];
  scene.fog = new THREE.Fog(first.horizon, first.fogNear, first.fogFar);

  const hemi = new THREE.HemisphereLight(first.hemiSky, first.hemiGround, first.hemiIntensity);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(first.sunColor, first.sunIntensity);
  sun.position.set(...first.sunPos);
  scene.add(sun);
  scene.add(sun.target); // target stays at the origin

  // Gradient sky dome: a big inside-out sphere with vertex colors.
  // Extra height segments keep the horizon band smooth.
  const skyGeo = new THREE.SphereGeometry(DOME_RADIUS, 48, 32);
  const pos = skyGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  skyGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
  const dome = new THREE.Mesh(skyGeo, skyMat);
  dome.frustumCulled = false;
  scene.add(dome);

  function paintDome(preset) {
    const top = new THREE.Color(preset.top);
    const mid = new THREE.Color(preset.mid);
    const horizon = new THREE.Color(preset.horizon);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / DOME_RADIUS;
      domeColorAt(y, top, mid, horizon, tmp);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    skyGeo.attributes.color.needsUpdate = true;
  }

  // Sun glow sprite, parked on the dome along the sun direction.
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture(), color: 0xfff1d6, fog: false, transparent: true
  }));
  scene.add(sunSprite);

  const clouds = createClouds();
  scene.add(clouds);

  function setPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    current = name;

    // Fog: color is the dome horizon color, exactly.
    scene.fog.color.setHex(preset.horizon);
    scene.fog.near = preset.fogNear;
    scene.fog.far = preset.fogFar;

    paintDome(preset);

    sun.color.setHex(preset.sunColor);
    sun.intensity = preset.sunIntensity;
    sun.position.set(...preset.sunPos);

    hemi.color.setHex(preset.hemiSky);
    hemi.groundColor.setHex(preset.hemiGround);
    hemi.intensity = preset.hemiIntensity;

    // Sun sprite: same direction as the light, just inside the dome.
    const dir = new THREE.Vector3(...preset.sunPos).normalize();
    sunSprite.position.copy(dir).multiplyScalar(DOME_RADIUS - 800);
    sunSprite.scale.set(preset.spriteScale, preset.spriteScale, 1);
    sunSprite.material.color.setHex(preset.sunColor);
    sunSprite.material.opacity = preset.spriteOpacity;
    sunSprite.visible = preset.spriteVisible;

    clouds.material.color.setHex(preset.cloudColor);
    clouds.material.emissive.setHex(preset.cloudColor).multiplyScalar(0.35);
    clouds.count = preset.cloudCount;

    if (renderer) renderer.toneMappingExposure = preset.exposure;
  }

  function getPreset() {
    return current;
  }

  setPreset(current);
  return { sun, hemi, clouds, setPreset, getPreset };
}
