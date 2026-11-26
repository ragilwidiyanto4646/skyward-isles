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

function createClouds() {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x8a8a8a, transparent: true, opacity: 0.95 });
  const warmMat = new THREE.MeshLambertMaterial({ color: 0xffe2c0, emissive: 0x9a7a55, transparent: true, opacity: 0.95 });
  const spots = [
    [-900, 420, -600], [700, 480, -1200], [1500, 400, 300], [-1600, 520, 800],
    [300, 560, 1600], [-500, 460, 1400], [1900, 540, -900], [-2100, 440, -1400],
    [100, 500, -2000], [1200, 620, 1400]
  ];
  for (const [cx, cy, cz] of spots) {
    const cloud = new THREE.Group();
    const puffs = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < puffs; i++) {
      const r = 45 + Math.random() * 55;
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), Math.random() > 0.4 ? mat : warmMat);
      m.position.set((Math.random() - 0.5) * 220, (Math.random() - 0.5) * 36, (Math.random() - 0.5) * 120);
      m.scale.y = 0.55;
      cloud.add(m);
    }
    cloud.position.set(cx, cy, cz);
    group.add(cloud);
  }
  return group;
}
