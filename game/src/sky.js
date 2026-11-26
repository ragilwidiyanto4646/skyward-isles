// sky.js — golden-hour sun, hemisphere light, fog, gradient sky dome and clouds.
import * as THREE from "three";

export function createSky(scene) {
  scene.fog = new THREE.Fog(0xf2c98a, 900, 5200);

  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x8a6a45, 0.85);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffc37a, 1.9);
  sun.position.set(-1400, 650, -900);
  scene.add(sun);
  scene.add(sun.target);

  // Gradient sky dome via a big sphere with vertex colors.
  const skyGeo = new THREE.SphereGeometry(6000, 24, 16);
  const pos = skyGeo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color(0x2e6fc2);
  const mid = new THREE.Color(0xf6b26b);
  const low = new THREE.Color(0xffd9a0);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 6000;
    if (y > 0.08) tmp.copy(mid).lerp(top, Math.min(1, (y - 0.08) / 0.45));
    else tmp.copy(low).lerp(mid, Math.max(0, (y + 0.15) / 0.23));
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  skyGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
  const dome = new THREE.Mesh(skyGeo, skyMat);
  scene.add(dome);

  // Sun disc sprite.
  const sunTex = makeGlowTexture();
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, color: 0xffe3a8, fog: false, transparent: true }));
  sunSprite.position.set(-3200, 1300, -2100);
  sunSprite.scale.set(900, 900, 1);
  scene.add(sunSprite);

  const clouds = createClouds();
  scene.add(clouds);
  return { sun, hemi, clouds };
}

function makeGlowTexture() {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, "rgba(255,244,200,1)");
  g.addColorStop(0.35, "rgba(255,205,120,0.85)");
  g.addColorStop(1, "rgba(255,180,90,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

// Procedural cloud puff: several overlapping soft radial gradients on a
// canvas give an irregular, feathery alpha edge instead of a hard blob.
function makePuffTexture(seed) {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = S; c.height = S;
  const ctx = c.getContext("2d");
  let s = seed * 2654435761 >>> 0;
  const rand = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  // Soft base wash so the puff has a body, not just bumps.
  let g = ctx.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S * 0.48);
  g.addColorStop(0, "rgba(255,255,255,0.45)");
  g.addColorStop(0.6, "rgba(255,255,255,0.22)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // Overlapping lobes at varied offsets/radii for an irregular silhouette.
  for (let i = 0; i < 16; i++) {
    const ang = rand() * Math.PI * 2;
    const dist = rand() * S * 0.26;
    const lx = S / 2 + Math.cos(ang) * dist;
    const ly = S / 2 + Math.sin(ang) * dist * 0.72;
    const lr = S * (0.13 + rand() * 0.17);
    const a = 0.16 + rand() * 0.3;
    g = ctx.createRadialGradient(lx, ly, 2, lx, ly, lr);
    g.addColorStop(0, "rgba(255,255,255," + a.toFixed(3) + ")");
    g.addColorStop(0.55, "rgba(255,255,255," + (a * 0.55).toFixed(3) + ")");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createClouds() {
  const group = new THREE.Group();
  const puffTex = [makePuffTexture(11), makePuffTexture(47), makePuffTexture(83)];
  // Main cloud deck (same spots as before) plus a higher, fainter layer so
  // the sky reads as layered fields of puffs rather than isolated blobs.
  const spots = [
    [-900, 420, -600], [700, 480, -1200], [1500, 400, 300], [-1600, 520, 800],
    [300, 560, 1600], [-500, 460, 1400], [1900, 540, -900], [-2100, 440, -1400],
    [100, 500, -2000], [1200, 620, 1400]
  ];
  const highSpots = [
    [-1300, 760, -300], [900, 820, -1600], [200, 780, 900],
    [-700, 860, 1900], [1700, 720, 1100], [-1900, 800, -1100]
  ];
  const buildCloud = (cx, cy, cz, spread, baseScale, baseOpacity) => {
    const cloud = new THREE.Group();
    const puffs = 10 + Math.floor(Math.random() * 6);
    for (let i = 0; i < puffs; i++) {
      const ox = (Math.random() - 0.5) * spread;
      const oy = (Math.random() - 0.5) * spread * 0.16;
      const oz = (Math.random() - 0.5) * spread * 0.45;
      // Tops brighter, bottoms warmer/dimmer; sun sits toward -x/-z, so
      // puffs on that side pick up a warm sunset tint.
      const sunSide = ox < 0 || oz < 0;
      const tint = oy > 6 ? 0xffffff : (sunSide ? 0xffd9b0 : 0xf3e4d4);
      const mat = new THREE.SpriteMaterial({
        map: puffTex[Math.floor(Math.random() * puffTex.length)],
        color: tint,
        transparent: true,
        opacity: baseOpacity * (0.55 + Math.random() * 0.45),
        depthWrite: false,
        rotation: Math.random() * Math.PI * 2
      });
      const sprite = new THREE.Sprite(mat);
      const sc = baseScale * (0.55 + Math.random() * 0.9);
      sprite.scale.set(sc, sc * 0.52, 1);
      sprite.position.set(ox, oy, oz);
      cloud.add(sprite);
    }
    cloud.position.set(cx, cy, cz);
    group.add(cloud);
  };
  for (const [cx, cy, cz] of spots) buildCloud(cx, cy, cz, 340, 230, 0.9);
  for (const [cx, cy, cz] of highSpots) buildCloud(cx, cy, cz, 460, 260, 0.45);
  return group;
}
