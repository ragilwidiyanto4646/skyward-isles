// cockpit3d.js — real 3D cockpit geometry attached to the camera.
//
// The group lives in camera space: -Z is forward, the instrument panel sits
// around z = -1.6, the windshield pillars frame the view, and an overhead
// panel hangs at the top of the frame. Four glass displays (PFD, ND, engine
// page, standby gauge cluster) are recessed into the panel face; each one is
// a CanvasTexture redrawn every frame from the flight state, adapting the
// instrument drawing logic that used to live in hud.js's 2D overlay.
//
// Original low-poly geometry only — boxes, cylinders and a torus, no assets.
import * as THREE from "three";

export function createCockpit3d() {
  const group = new THREE.Group();

  // ---- Materials -----------------------------------------------------------
  const panelMat = new THREE.MeshLambertMaterial({ color: 0x39424f });
  const panelSideMat = new THREE.MeshLambertMaterial({ color: 0x333d4a });
  const trimMat = new THREE.MeshLambertMaterial({ color: 0x232b36 });
  const bezelMat = new THREE.MeshLambertMaterial({ color: 0x0b0e13 });
  const metalMat = new THREE.MeshLambertMaterial({ color: 0x4a5666 });
  const toggleMat = new THREE.MeshLambertMaterial({ color: 0x9fb4c9 });
  const yokeMat = new THREE.MeshLambertMaterial({ color: 0x1d232d });

  // ---- Small helpers -------------------------------------------------------
  function box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  }

  // Tapered post between two points (window pillars).
  function postBetween(ax, ay, az, bx, by, bz, rBottom, rTop, mat) {
    const a = new THREE.Vector3(ax, ay, az);
    const b = new THREE.Vector3(bx, by, bz);
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(rTop, rBottom, len, 8);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return m;
  }

  // A glass display: offscreen canvas + CanvasTexture on a self-lit plane.
  function makeScreen(canvasW, canvasH, planeW, planeH) {
    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d");
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(planeW, planeH),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
    );
    return { canvas, ctx, texture, mesh, w: canvasW, h: canvasH };
  }

  // Mount a screen into a panel section: four bezel bars stand proud of the
  // panel face (z = 0 locally) while the screen plane sits behind their
  // front faces, so the display reads as recessed glass.
  function addScreen(parent, screen, cx, cy, w, h) {
    const t = 0.04;   // bezel bar thickness
    const d = 0.04;   // bezel depth
    const zc = 0.012; // bezel center: front face at +0.032
    parent.add(box(w + t * 2, t, d, bezelMat, cx, cy + h / 2 + t / 2, zc));
    parent.add(box(w + t * 2, t, d, bezelMat, cx, cy - h / 2 - t / 2, zc));
    parent.add(box(t, h, d, bezelMat, cx - w / 2 - t / 2, cy, zc));
    parent.add(box(t, h, d, bezelMat, cx + w / 2 + t / 2, cy, zc));
    screen.mesh.position.set(cx, cy, 0.006);
    parent.add(screen.mesh);
  }

  // Small round knob (rotary encoder look) on a panel face.
  function addKnob(parent, x, y, r) {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.03, 10), metalMat);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(x, y, 0.015);
    parent.add(knob);
  }

  // ---- Static panel-face textures ------------------------------------------
  // Each panel section gets a printed face: blue-gray base with seams,
  // screw heads, placards, knob labels and a row of toggle-switch glyphs
  // along the bottom edge, so the shell reads dense instead of hollow.
  // Drawing happens in panel-local coordinates (origin at section center,
  // +y up); X()/Y() map those to canvas pixels.
  function makePanelFace(width, height, canvasW, canvasH, drawFn) {
    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const c = canvas.getContext("2d");
    const X = (x) => ((x + width / 2) / width) * canvasW;
    const Y = (y) => ((height / 2 - y) / height) * canvasH;
    const S = canvasW / width; // pixels per panel unit (x scale)

    // Base: slightly lighter blue-gray with a subtle vertical gradient.
    const grad = c.createLinearGradient(0, 0, 0, canvasH);
    grad.addColorStop(0, "#46536a");
    grad.addColorStop(0.5, "#3d495c");
    grad.addColorStop(1, "#333f52");
    c.fillStyle = grad;
    c.fillRect(0, 0, canvasW, canvasH);
    // Fine speckle noise so the surface is not a flat fill.
    c.fillStyle = "rgba(255,255,255,0.05)";
    for (let i = 0; i < 900; i++) {
      c.fillRect(Math.random() * canvasW, Math.random() * canvasH, 1.4, 1.4);
    }
    c.fillStyle = "rgba(0,0,0,0.08)";
    for (let i = 0; i < 700; i++) {
      c.fillRect(Math.random() * canvasW, Math.random() * canvasH, 1.4, 1.4);
    }
    // Horizontal seam lines.
    c.strokeStyle = "rgba(10,14,20,0.55)";
    c.lineWidth = 2;
    for (const sy of [0.33, -0.22, -0.335]) {
      c.beginPath();
      c.moveTo(6, Y(sy));
      c.lineTo(canvasW - 6, Y(sy));
      c.stroke();
    }
    c.strokeStyle = "rgba(180,205,235,0.18)";
    c.lineWidth = 1;
    for (const sy of [0.33, -0.22, -0.335]) {
      c.beginPath();
      c.moveTo(6, Y(sy) + 2);
      c.lineTo(canvasW - 6, Y(sy) + 2);
      c.stroke();
    }
    // Screw heads at corners and edge midpoints: filled circle + cross slot.
    function screw(x, y) {
      const px = X(x), py = Y(y), r = 0.011 * S;
      c.fillStyle = "#8fa3ba";
      c.beginPath(); c.arc(px, py, r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#202833";
      c.lineWidth = 1.6;
      c.beginPath();
      c.moveTo(px - r * 0.7, py); c.lineTo(px + r * 0.7, py);
      c.moveTo(px, py - r * 0.7); c.lineTo(px, py + r * 0.7);
      c.stroke();
    }
    const mx = width / 2 - 0.035, my = height / 2 - 0.035;
    for (const sx of [-mx, 0, mx]) {
      screw(sx, my);
      screw(sx, -my);
    }
    screw(-mx, 0);
    screw(mx, 0);

    drawFn(c, X, Y, S);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
    );
    mesh.position.z = 0.002;
    return mesh;
  }

  // Placard / label text in the panel's light print color.
  function panelText(c, X, Y, text, x, y, px, align) {
    c.fillStyle = "#cfe3f7";
    c.font = "bold " + px + "px sans-serif";
    c.textAlign = align || "center";
    c.fillText(text, X(x), Y(y));
  }

  // One printed toggle switch: mounting plate + filled lever with a knob,
  // plus a tiny label above it. up=true draws the lever in the ON position.
  function toggleGlyph(c, X, Y, S, x, y, label, up) {
    const px = X(x), py = Y(y);
    const w = 0.02 * S, h = 0.038 * S;
    c.fillStyle = "#232b36";
    c.fillRect(px - w / 2, py - h / 2, w, h);
    c.strokeStyle = "#6b7a8d";
    c.lineWidth = 1.4;
    c.strokeRect(px - w / 2, py - h / 2, w, h);
    c.strokeStyle = "#d7e3f2";
    c.lineWidth = Math.max(2.5, 0.006 * S);
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(px, py + (up ? h * 0.22 : -h * 0.22));
    c.lineTo(px, py + (up ? -h * 0.3 : h * 0.3));
    c.stroke();
    c.lineCap = "butt";
    c.fillStyle = "#e8f2ff";
    c.beginPath();
    c.arc(px, py + (up ? -h * 0.34 : h * 0.34), Math.max(2, 0.005 * S), 0, Math.PI * 2);
    c.fill();
    if (label) panelText(c, X, Y, label, x, y + 0.032, 9);
  }

  // ---- Screens -------------------------------------------------------------
  const pfd = makeScreen(384, 300, 0.66, 0.515);
  const nd = makeScreen(384, 300, 0.66, 0.515);
  const eng = makeScreen(320, 300, 0.58, 0.545);
  const stby = makeScreen(320, 300, 0.58, 0.545);

  // ---- Instrument panel: center section + wrap-around side sections --------
  // Each section is a group whose local z = 0 plane is the panel face; the
  // panel slab extends backward (-Z). Sections are tilted back slightly.
  const PANEL_Y = -0.45;
  const PANEL_Z = -1.6;
  const PANEL_TILT = -0.1;
  const PANEL_H = 0.8;

  function makeSection(width, mat) {
    const s = new THREE.Group();
    s.rotation.order = "YXZ";
    s.rotation.x = PANEL_TILT;
    const slab = box(width, PANEL_H, 0.14, mat, 0, 0, -0.07);
    s.add(slab);
    // Glareshield: padded lip overhanging the top edge toward the pilot.
    const shield = box(width + 0.06, 0.05, 0.32, trimMat, 0, PANEL_H / 2 + 0.035, 0.08);
    shield.rotation.x = 0.32;
    s.add(shield);
    const lip = box(width + 0.06, 0.1, 0.05, trimMat, 0, PANEL_H / 2 + 0.01, 0.22);
    lip.rotation.x = 0.32;
    s.add(lip);
    return s;
  }

  // Center section with PFD + ND.
  const center = makeSection(1.7, panelMat);
  center.position.set(0, PANEL_Y, PANEL_Z);
  group.add(center);
  addScreen(center, pfd, -0.42, 0.04, 0.66, 0.515);
  addScreen(center, nd, 0.42, 0.04, 0.66, 0.515);
  addKnob(center, -0.72, -0.3, 0.022);
  addKnob(center, -0.52, -0.3, 0.022);
  addKnob(center, 0.52, -0.3, 0.022);
  addKnob(center, 0.72, -0.3, 0.022);
  // Printed center face: display placards, annunciator labels above the
  // lamps, knob labels, and a toggle row along the bottom edge.
  center.add(makePanelFace(1.7, PANEL_H, 1024, 480, (c, X, Y, S) => {
    panelText(c, X, Y, "SKYWARD ISLES", 0, 0.365, 13);
    panelText(c, X, Y, "PRIMARY FLIGHT DISPLAY", -0.48, -0.278, 12);
    panelText(c, X, Y, "NAVIGATION DISPLAY", 0.48, -0.278, 12);
    const lampLabels = ["LOW FUEL", "STALL", "GEAR", "OIL", "ALT"];
    lampLabels.forEach((t, i) => panelText(c, X, Y, t, -0.32 + i * 0.16, -0.262, 10));
    panelText(c, X, Y, "BARO", -0.795, -0.315, 11);
    panelText(c, X, Y, "HDG", -0.62, -0.315, 11);
    panelText(c, X, Y, "CRS", 0.62, -0.315, 11);
    panelText(c, X, Y, "ALT", 0.795, -0.315, 11);
    const toggles = ["MASTER", "AVIONICS", "FUEL PUMP", "BEACON",
                     "STROBE", "TAXI", "LANDING", "PITOT HEAT"];
    toggles.forEach((t, i) => toggleGlyph(c, X, Y, S, -0.7 + i * 0.2, -0.372, t, i % 3 !== 2));
  }));

  // Annunciator lamps under the center displays (lit state set in update()).
  const lampMats = [];
  const lampColors = [0xff5a4e, 0xff5a4e, 0x2fbf71, 0xffb340, 0xffb340];
  for (let i = 0; i < 5; i++) {
    const housing = box(0.13, 0.05, 0.02, bezelMat, -0.32 + i * 0.16, -0.31, 0.005);
    center.add(housing);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0x232b36, toneMapped: false });
    const lamp = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.034), lampMat);
    lamp.position.set(-0.32 + i * 0.16, -0.31, 0.016);
    center.add(lamp);
    lampMats.push(lampMat);
  }

  // Left section (standby gauges), hinged at the center panel's left edge
  // and angled back so the panel wraps around the pilot.
  const leftHinge = new THREE.Group();
  leftHinge.position.set(-0.85, PANEL_Y, PANEL_Z);
  leftHinge.rotation.order = "YXZ";
  leftHinge.rotation.y = -0.55;
  leftHinge.rotation.x = PANEL_TILT;
  group.add(leftHinge);
  const leftSlab = box(0.92, PANEL_H, 0.14, panelSideMat, -0.46, 0, -0.07);
  leftHinge.add(leftSlab);
  const leftShield = box(0.98, 0.05, 0.32, trimMat, -0.46, PANEL_H / 2 + 0.035, 0.08);
  leftShield.rotation.x = 0.32;
  leftHinge.add(leftShield);
  addScreen(leftHinge, stby, -0.46, 0.04, 0.58, 0.545);
  addKnob(leftHinge, -0.7, -0.3, 0.022);
  addKnob(leftHinge, -0.22, -0.3, 0.022);
  // Printed left face (coords relative to the section center at x = -0.46).
  const leftFace = makePanelFace(0.92, PANEL_H, 560, 480, (c, X, Y, S) => {
    panelText(c, X, Y, "STANDBY INSTRUMENTS", 0, -0.278, 12);
    panelText(c, X, Y, "DIM", -0.355, -0.315, 11);
    panelText(c, X, Y, "TEST", 0.355, -0.315, 11);
    const toggles = ["BAT", "ALT", "MAG L", "MAG R"];
    toggles.forEach((t, i) => toggleGlyph(c, X, Y, S, -0.33 + i * 0.22, -0.372, t, i !== 2));
  });
  leftFace.position.x = -0.46;
  leftHinge.add(leftFace);

  // Right section (engine page), mirrored.
  const rightHinge = new THREE.Group();
  rightHinge.position.set(0.85, PANEL_Y, PANEL_Z);
  rightHinge.rotation.order = "YXZ";
  rightHinge.rotation.y = 0.55;
  rightHinge.rotation.x = PANEL_TILT;
  group.add(rightHinge);
  const rightSlab = box(0.92, PANEL_H, 0.14, panelSideMat, 0.46, 0, -0.07);
  rightHinge.add(rightSlab);
  const rightShield = box(0.98, 0.05, 0.32, trimMat, 0.46, PANEL_H / 2 + 0.035, 0.08);
  rightShield.rotation.x = 0.32;
  rightHinge.add(rightShield);
  addScreen(rightHinge, eng, 0.46, 0.04, 0.58, 0.545);
  addKnob(rightHinge, 0.22, -0.3, 0.022);
  addKnob(rightHinge, 0.7, -0.3, 0.022);
  // Printed right face (coords relative to the section center at x = +0.46).
  const rightFace = makePanelFace(0.92, PANEL_H, 560, 480, (c, X, Y, S) => {
    panelText(c, X, Y, "ENGINE", 0, -0.278, 13);
    panelText(c, X, Y, "DIM", -0.355, -0.315, 11);
    panelText(c, X, Y, "TEST", 0.355, -0.315, 11);
    const toggles = ["NAV", "BEACON", "STROBE", "LANDING"];
    toggles.forEach((t, i) => toggleGlyph(c, X, Y, S, -0.33 + i * 0.22, -0.372, t, i !== 3));
  });
  rightFace.position.x = 0.46;
  rightHinge.add(rightFace);

  // ---- Windshield frame: pillars + header bar ------------------------------
  // Two tapered outer posts angling up and outward from the panel corners,
  // plus a slim center post, giving the two-pane windshield look.
  group.add(postBetween(-1.3, -0.05, -1.66, -1.66, 1.18, -1.98, 0.09, 0.05, trimMat));
  group.add(postBetween(1.3, -0.05, -1.66, 1.66, 1.18, -1.98, 0.09, 0.05, trimMat));
  group.add(postBetween(0, -0.03, -1.72, 0, 1.12, -1.92, 0.04, 0.028, trimMat));
  const header = box(3.45, 0.13, 0.12, trimMat, 0, 1.16, -1.97);
  header.rotation.x = -0.18;
  group.add(header);
  // Grab handles on the outer pillars.
  for (const side of [-1, 1]) {
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 8, 20), metalMat);
    handle.position.set(side * 1.42, 0.52, -1.8);
    handle.rotation.z = side * -0.28;
    group.add(handle);
  }

  // ---- Overhead panel -------------------------------------------------------
  // Angled panel above the windshield, face tilted down toward the pilot.
  // Switches are drawn once onto a canvas texture (static) and a few tiny
  // 3D toggles protrude for depth.
  const overhead = new THREE.Group();
  overhead.position.set(0, 0.74, -1.32);
  overhead.rotation.x = 0.85;
  group.add(overhead);
  overhead.add(box(1.5, 0.56, 0.07, panelMat, 0, 0, -0.035));

  const ohCanvas = document.createElement("canvas");
  ohCanvas.width = 512;
  ohCanvas.height = 192;
  {
    const c = ohCanvas.getContext("2d");
    // Lighter blue-gray base to match the panel faces.
    const grad = c.createLinearGradient(0, 0, 0, 192);
    grad.addColorStop(0, "#46536a");
    grad.addColorStop(1, "#39465c");
    c.fillStyle = grad;
    c.fillRect(0, 0, 512, 192);
    c.fillStyle = "rgba(255,255,255,0.05)";
    for (let i = 0; i < 350; i++) {
      c.fillRect(Math.random() * 512, Math.random() * 192, 1.4, 1.4);
    }
    c.strokeStyle = "#2e3947";
    c.lineWidth = 3;
    c.strokeRect(4, 4, 504, 184);
    c.textAlign = "center";

    // Four labeled sections, two toggles each.
    const sections = [
      { name: "ELEC", switches: ["BAT", "ALT"] },
      { name: "LIGHTS", switches: ["NAV", "LAND"] },
      { name: "FUEL", switches: ["PUMP", "XFEED"] },
      { name: "ICE", switches: ["PITOT", "HEAT"] }
    ];
    // Indicator dots: a few lit bright, the rest dark.
    const dotLit = ["#3dff7a", "#3dff7a", "#ffb340", null, "#3dff7a", null, "#ffb340", null];
    sections.forEach((sec, s) => {
      const sx = 8 + s * 126;
      // Section divider + header
      if (s > 0) {
        c.strokeStyle = "rgba(10,14,20,0.5)";
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(sx - 4, 10);
        c.lineTo(sx - 4, 150);
        c.stroke();
      }
      c.fillStyle = "#7fa8cc";
      c.font = "bold 14px sans-serif";
      c.fillText(sec.name, sx + 59, 26);
      sec.switches.forEach((label, j) => {
        const i = s * 2 + j;
        const x = sx + 32 + j * 56;
        const up = i % 3 !== 2;
        // Indicator dot above the switch
        c.fillStyle = dotLit[i] || "#2b333f";
        c.beginPath();
        c.arc(x, 44, 7, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = "#8fa3ba";
        c.lineWidth = 1.6;
        c.beginPath();
        c.arc(x, 44, 7, 0, Math.PI * 2);
        c.stroke();
        if (dotLit[i]) {
          c.fillStyle = "rgba(255,255,255,0.55)";
          c.beginPath();
          c.arc(x - 2, 42, 2.2, 0, Math.PI * 2);
          c.fill();
        }
        // Toggle: mounting plate + filled lever with knob
        c.fillStyle = "#232b36";
        c.fillRect(x - 9, 58, 18, 44);
        c.strokeStyle = "#6b7a8d";
        c.lineWidth = 2;
        c.strokeRect(x - 9, 58, 18, 44);
        c.strokeStyle = "#d7e3f2";
        c.lineWidth = 6;
        c.lineCap = "round";
        c.beginPath();
        c.moveTo(x, up ? 92 : 68);
        c.lineTo(x, up ? 68 : 92);
        c.stroke();
        c.lineCap = "butt";
        c.fillStyle = "#e8f2ff";
        c.beginPath();
        c.arc(x, up ? 66 : 94, 4.5, 0, Math.PI * 2);
        c.fill();
        // ON / OFF micro-labels + switch name
        c.fillStyle = "#9fb4c9";
        c.font = "bold 7px sans-serif";
        c.fillText("ON", x, 56);
        c.fillText("OFF", x, 112);
        c.fillStyle = "#cfe3f7";
        c.font = "bold 12px sans-serif";
        c.fillText(label, x, 128);
      });
    });

    // Breaker row along the bottom, tiny label under each.
    const breakers = ["PITOT", "GPS", "COM", "NAV", "XPDR", "FLAP", "TRIM", "GEAR"];
    breakers.forEach((label, i) => {
      const x = 44 + i * 61;
      c.fillStyle = "#39424f";
      c.beginPath();
      c.arc(x, 152, 9, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = "#8fa3ba";
      c.lineWidth = 2;
      c.beginPath();
      c.arc(x, 152, 9, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = "#cfe3f7";
      c.beginPath();
      c.arc(x, 152, 2.6, 0, Math.PI * 2);
      c.fill();
      c.font = "bold 8px sans-serif";
      c.fillText(label, x, 174);
    });
  }
  const ohTexture = new THREE.CanvasTexture(ohCanvas);
  ohTexture.colorSpace = THREE.SRGBColorSpace;
  const ohFace = new THREE.Mesh(
    new THREE.PlaneGeometry(1.44, 0.5),
    new THREE.MeshBasicMaterial({ map: ohTexture, toneMapped: false })
  );
  ohFace.position.z = 0.004;
  overhead.add(ohFace);
  // A few protruding 3D toggles along the lower edge.
  for (let i = 0; i < 5; i++) {
    const tog = box(0.02, 0.045, 0.025, toggleMat, -0.5 + i * 0.25, -0.19, 0.015);
    overhead.add(tog);
  }

  // ---- Center pedestal ---------------------------------------------------------
  // Fills the void below the panel: a radio stack printed on a static
  // canvas face (COM/NAV/XPDR with digit windows), toggle glyphs below.
  const pedestal = new THREE.Group();
  pedestal.position.set(0, -0.95, -1.45);
  group.add(pedestal);
  pedestal.add(box(0.7, 0.55, 0.3, panelMat, 0, 0, 0));

  const pedCanvas = document.createElement("canvas");
  pedCanvas.width = 512;
  pedCanvas.height = 384;
  {
    const c = pedCanvas.getContext("2d");
    const grad = c.createLinearGradient(0, 0, 0, 384);
    grad.addColorStop(0, "#46536a");
    grad.addColorStop(1, "#333f52");
    c.fillStyle = grad;
    c.fillRect(0, 0, 512, 384);
    c.fillStyle = "rgba(255,255,255,0.05)";
    for (let i = 0; i < 500; i++) {
      c.fillRect(Math.random() * 512, Math.random() * 384, 1.4, 1.4);
    }
    c.strokeStyle = "#2e3947";
    c.lineWidth = 3;
    c.strokeRect(4, 4, 504, 376);
    c.fillStyle = "#7fa8cc";
    c.font = "bold 18px sans-serif";
    c.textAlign = "center";
    c.fillText("RADIO / XPDR", 256, 34);

    // Radio rows: label, dark digit window with green digits, tuning knobs.
    const radios = [
      ["COM1", "118.70"],
      ["COM2", "121.50"],
      ["NAV1", "110.30"],
      ["XPDR", "1200"]
    ];
    radios.forEach(([label, freq], i) => {
      const y = 56 + i * 58;
      c.fillStyle = "#232b36";
      c.fillRect(28, y, 456, 48);
      c.strokeStyle = "#6b7a8d";
      c.lineWidth = 2;
      c.strokeRect(28, y, 456, 48);
      c.fillStyle = "#cfe3f7";
      c.font = "bold 19px sans-serif";
      c.textAlign = "left";
      c.fillText(label, 44, y + 32);
      // Digit window
      c.fillStyle = "#05080e";
      c.fillRect(150, y + 8, 170, 32);
      c.strokeStyle = "#4a5666";
      c.lineWidth = 1.6;
      c.strokeRect(150, y + 8, 170, 32);
      c.fillStyle = "#57e6a9";
      c.font = "bold 24px monospace";
      c.textAlign = "center";
      c.fillText(freq, 235, y + 33);
      // Two tuning knobs on the right
      for (const kx of [372, 432]) {
        c.fillStyle = "#39424f";
        c.beginPath();
        c.arc(kx, y + 24, 15, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = "#8fa3ba";
        c.lineWidth = 2;
        c.beginPath();
        c.arc(kx, y + 24, 15, 0, Math.PI * 2);
        c.stroke();
        c.strokeStyle = "#e8f2ff";
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(kx, y + 24);
        c.lineTo(kx + 8, y + 14);
        c.stroke();
      }
    });

    // Toggle glyphs along the bottom of the pedestal face.
    const pedToggles = ["MIC", "SPKR", "ICS", "DME", "ADF", "MKR"];
    pedToggles.forEach((label, i) => {
      const x = 62 + i * 78;
      const up = i % 2 === 0;
      c.fillStyle = "#232b36";
      c.fillRect(x - 8, 306, 16, 34);
      c.strokeStyle = "#6b7a8d";
      c.lineWidth = 1.6;
      c.strokeRect(x - 8, 306, 16, 34);
      c.strokeStyle = "#d7e3f2";
      c.lineWidth = 5;
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(x, up ? 332 : 314);
      c.lineTo(x, up ? 314 : 332);
      c.stroke();
      c.lineCap = "butt";
      c.fillStyle = "#e8f2ff";
      c.beginPath();
      c.arc(x, up ? 312 : 334, 3.6, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#cfe3f7";
      c.font = "bold 11px sans-serif";
      c.textAlign = "center";
      c.fillText(label, x, 360);
    });
  }
  const pedTexture = new THREE.CanvasTexture(pedCanvas);
  pedTexture.colorSpace = THREE.SRGBColorSpace;
  const pedFace = new THREE.Mesh(
    new THREE.PlaneGeometry(0.66, 0.5),
    new THREE.MeshBasicMaterial({ map: pedTexture, toneMapped: false })
  );
  pedFace.position.z = 0.152;
  pedestal.add(pedFace);

  // ---- Standby compass on the glareshield --------------------------------------
  const compass = new THREE.Group();
  compass.position.set(0, 0.045, -1.5);
  group.add(compass);
  compass.add(box(0.1, 0.075, 0.07, trimMat, 0, 0, 0));
  const compassBall = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 16, 12),
    new THREE.MeshLambertMaterial({ color: 0xd7e3f2 })
  );
  compassBall.position.set(0, 0, 0.028);
  compass.add(compassBall);
  compass.add(box(0.11, 0.015, 0.08, bezelMat, 0, 0.045, 0));

  // ---- Yoke ------------------------------------------------------------------
  // Column rising from below the panel + a wheel that rolls with bank and
  // shifts fore/aft with pitch (mirrors the old 2D yoke behavior).
  const yoke = new THREE.Group();
  const YOKE_BASE = new THREE.Vector3(0, -0.6, -1.08);
  yoke.position.copy(YOKE_BASE);
  group.add(yoke);

  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.55, 8), metalMat);
  column.position.set(0, -0.16, -0.18);
  column.rotation.x = 1.15;
  yoke.add(column);

  const wheel = new THREE.Group();
  wheel.rotation.x = -0.35;
  yoke.add(wheel);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.028, 8, 24), yokeMat);
  wheel.add(rim);
  const spokeH = box(0.32, 0.035, 0.03, yokeMat, 0, 0, 0);
  wheel.add(spokeH);
  const spokeV = box(0.035, 0.3, 0.03, yokeMat, 0, 0, 0);
  wheel.add(spokeV);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12), metalMat);
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  const hubDot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.056, 10),
    new THREE.MeshBasicMaterial({ color: 0xd13a2f, toneMapped: false })
  );
  hubDot.rotation.x = Math.PI / 2;
  wheel.add(hubDot);

  // ---- Side consoles ---------------------------------------------------------
  for (const side of [-1, 1]) {
    const console_ = box(0.42, 0.1, 0.75, panelSideMat, side * 0.82, -0.68, -1.18);
    console_.rotation.x = -0.18;
    console_.rotation.z = side * -0.22;
    group.add(console_);
    const consoleTop = box(0.34, 0.04, 0.6, trimMat, side * 0.8, -0.62, -1.18);
    consoleTop.rotation.x = -0.18;
    consoleTop.rotation.z = side * -0.22;
    group.add(consoleTop);
    // Row of small switch blocks along the console top.
    for (let i = 0; i < 4; i++) {
      const sw = box(0.035, 0.025, 0.05, toggleMat, side * 0.86, -0.59, -1.38 + i * 0.13);
      sw.rotation.x = -0.18;
      sw.rotation.z = side * -0.22;
      group.add(sw);
    }
    // Label strip printed on the console top.
    const stripCanvas = document.createElement("canvas");
    stripCanvas.width = 256;
    stripCanvas.height = 96;
    {
      const c = stripCanvas.getContext("2d");
      c.fillStyle = "#39465c";
      c.fillRect(0, 0, 256, 96);
      c.strokeStyle = "#6b7a8d";
      c.lineWidth = 3;
      c.strokeRect(3, 3, 250, 90);
      c.fillStyle = "#cfe3f7";
      c.font = "bold 26px sans-serif";
      c.textAlign = "center";
      c.fillText(side < 0 ? "TRIM / FLAPS" : "LIGHTS / DEICE", 128, 42);
      c.fillStyle = "#9fb4c9";
      c.font = "bold 15px sans-serif";
      c.fillText(side < 0 ? "UP    DN    0  10  20  30" : "NAV  BCN  STRB  ICE", 128, 72);
    }
    const stripTexture = new THREE.CanvasTexture(stripCanvas);
    stripTexture.colorSpace = THREE.SRGBColorSpace;
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.11),
      new THREE.MeshBasicMaterial({ map: stripTexture, toneMapped: false })
    );
    strip.position.set(side * 0.74, -0.596, -1.05);
    strip.rotation.order = "YXZ";
    strip.rotation.x = -Math.PI / 2 + 0.18;
    strip.rotation.z = side * -0.22;
    group.add(strip);
  }
  // Three-lever quadrant on the left console: throttle (black knob),
  // prop (blue knob), mixture (red knob).
  const thrBase = box(0.22, 0.05, 0.22, bezelMat, -0.8, -0.58, -1.15);
  group.add(thrBase);
  const leverKnobs = [0x1d232d, 0x2f6fd1, 0xd13a2f];
  leverKnobs.forEach((knobColor, i) => {
    const lx = -0.87 + i * 0.07;
    const lever = box(0.025, 0.09, 0.025, metalMat, lx, -0.53, -1.18);
    lever.rotation.x = -0.3;
    group.add(lever);
    const knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 12, 10),
      new THREE.MeshLambertMaterial({ color: knobColor })
    );
    knob.position.set(lx, -0.487, -1.193);
    group.add(knob);
  });

  // ---- Cockpit light -----------------------------------------------------------
  // Soft warm light so the panel reads at every heading. Short range keeps
  // it from lighting up the world outside.
  const cockpitLight = new THREE.PointLight(0xffe8c8, 5.5, 7, 1.2);
  cockpitLight.position.set(0, 0.3, -0.7);
  group.add(cockpitLight);

  // ==========================================================================
  // Screen drawing — adapted from the instrument logic in hud.js, redrawn
  // per-screen at each canvas's own resolution.
  // ==========================================================================
  const GAUGE_A0 = Math.PI * 0.75;
  const GAUGE_A1 = Math.PI * 2.25;

  function gaugeAngle(frac) {
    return GAUGE_A0 + (GAUGE_A1 - GAUGE_A0) * THREE.MathUtils.clamp(frac, 0, 1);
  }

  function drawGaugeFace(ctx, cx, cy, r, label, ticks, arc) {
    ctx.fillStyle = "#2b333f";
    ctx.beginPath(); ctx.arc(cx, cy, r + 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#6b7a8d"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r + 4, 0, Math.PI * 2); ctx.stroke();
    const grad = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
    grad.addColorStop(0, "#26344a");
    grad.addColorStop(0.75, "#16202f");
    grad.addColorStop(1, "#0d1420");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    if (arc) {
      ctx.strokeStyle = arc.color; ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, r - 5, gaugeAngle(arc.from), gaugeAngle(arc.to));
      ctx.stroke();
    }
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const t of ticks) {
      const a = gaugeAngle(t.frac);
      const len = t.major ? 9 : 5;
      ctx.strokeStyle = "#e8f2ff"; ctx.lineWidth = t.major ? 2.5 : 1.4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3));
      ctx.lineTo(cx + Math.cos(a) * (r - 3 - len), cy + Math.sin(a) * (r - 3 - len));
      ctx.stroke();
      if (t.text) {
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 12px sans-serif";
        ctx.fillText(t.text, cx + Math.cos(a) * (r - 17), cy + Math.sin(a) * (r - 17));
      }
    }
    ctx.fillStyle = "#bfe2ff";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText(label, cx, cy + r * 0.62);
    ctx.textBaseline = "alphabetic";
  }

  function drawNeedle(ctx, cx, cy, r, frac, color) {
    const a = gaugeAngle(frac);
    ctx.strokeStyle = color || "#ffdf6b";
    ctx.lineWidth = 3.5; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * 7, cy - Math.sin(a) * 7);
    ctx.lineTo(cx + Math.cos(a) * (r - 11), cy + Math.sin(a) * (r - 11));
    ctx.stroke();
    ctx.fillStyle = "#d7e3f2";
    ctx.beginPath(); ctx.arc(cx, cy, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.lineCap = "butt";
  }

  function screenTitle(ctx, w, text) {
    ctx.fillStyle = "#9fc4e8";
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(text, w / 2, 22);
  }

  // ---- PFD: attitude ball + speed/altitude tapes + heading strip ----------
  function drawPFD(flight, knots, feet, hdgDeg) {
    const ctx = pfd.ctx;
    const W = pfd.w, H = pfd.h;
    ctx.fillStyle = "#05080e";
    ctx.fillRect(0, 0, W, H);
    screenTitle(ctx, W, "PFD");

    const tapeW = 62;
    const ballX = tapeW + 6, ballW = W - tapeW * 2 - 12;
    const ballY = 30, ballH = H - 30 - 34;
    const bcx = ballX + ballW / 2, bcy = ballY + ballH / 2;

    // Attitude ball with pitch ladder
    ctx.save();
    ctx.beginPath(); ctx.rect(ballX, ballY, ballW, ballH); ctx.clip();
    ctx.translate(bcx, bcy);
    ctx.rotate(-flight.roll);
    const pitchPx = THREE.MathUtils.clamp(flight.pitch, -0.9, 0.9) * 130;
    ctx.translate(0, pitchPx);
    ctx.fillStyle = "#2f7fc4"; ctx.fillRect(-ballW, -ballH, ballW * 2, ballH);
    ctx.fillStyle = "#8a5a33"; ctx.fillRect(-ballW, 0, ballW * 2, ballH);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(-ballW, -1.5, ballW * 2, 3);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center";
    for (const deg of [-20, -10, 10, 20]) {
      const off = -deg * 3.4;
      const len = Math.abs(deg) === 10 ? 58 : 40;
      ctx.fillRect(-len / 2, off - 1, len, 2);
      ctx.fillText(String(Math.abs(deg)), -len / 2 - 12, off + 4);
      ctx.fillText(String(Math.abs(deg)), len / 2 + 12, off + 4);
    }
    ctx.restore();
    // Fixed aircraft symbol
    ctx.strokeStyle = "#ffd75e"; ctx.lineWidth = 4.5; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(bcx - 46, bcy); ctx.lineTo(bcx - 12, bcy);
    ctx.moveTo(bcx + 12, bcy); ctx.lineTo(bcx + 46, bcy);
    ctx.stroke(); ctx.lineCap = "butt";
    ctx.fillStyle = "#ffd75e";
    ctx.beginPath(); ctx.arc(bcx, bcy, 4.5, 0, Math.PI * 2); ctx.fill();

    // Speed tape (left)
    ctx.save();
    ctx.beginPath(); ctx.rect(4, ballY, tapeW, ballH); ctx.clip();
    ctx.fillStyle = "rgba(8,12,20,0.9)";
    ctx.fillRect(4, ballY, tapeW, ballH);
    const pxPerKt = ballH / 90;
    ctx.fillStyle = "#ffffff"; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "left";
    ctx.strokeStyle = "#9fd8ff"; ctx.lineWidth = 2;
    const ktStart = Math.floor((knots - 50) / 10) * 10;
    for (let kt = ktStart; kt <= knots + 50; kt += 10) {
      if (kt < 0) continue;
      const ty = bcy - (kt - knots) * pxPerKt;
      ctx.beginPath(); ctx.moveTo(tapeW - 6, ty); ctx.lineTo(tapeW + 2, ty); ctx.stroke();
      if (kt % 20 === 0) ctx.fillText(String(kt), 8, ty + 5);
    }
    ctx.restore();
    ctx.fillStyle = "#0b0e13";
    ctx.fillRect(6, bcy - 14, tapeW - 4, 28);
    ctx.strokeStyle = "#57e6a9"; ctx.lineWidth = 2.5;
    ctx.strokeRect(6, bcy - 14, tapeW - 4, 28);
    ctx.fillStyle = "#57e6a9"; ctx.font = "bold 19px monospace"; ctx.textAlign = "center";
    ctx.fillText(String(Math.round(knots)), 4 + tapeW / 2, bcy + 7);

    // Altitude tape (right)
    const ax = W - tapeW - 4;
    ctx.save();
    ctx.beginPath(); ctx.rect(ax, ballY, tapeW, ballH); ctx.clip();
    ctx.fillStyle = "rgba(8,12,20,0.9)";
    ctx.fillRect(ax, ballY, tapeW, ballH);
    const pxPerFt = ballH / 900;
    ctx.fillStyle = "#ffffff"; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "left";
    ctx.strokeStyle = "#9fd8ff"; ctx.lineWidth = 2;
    const ftStart = Math.floor((feet - 500) / 100) * 100;
    for (let ft = ftStart; ft <= feet + 500; ft += 100) {
      if (ft < 0) continue;
      const ty = bcy - (ft - feet) * pxPerFt;
      ctx.beginPath(); ctx.moveTo(ax + 2, ty); ctx.lineTo(ax + 10, ty); ctx.stroke();
      if (ft % 200 === 0) ctx.fillText(String(ft / 100), ax + 14, ty + 5);
    }
    ctx.restore();
    ctx.fillStyle = "#0b0e13";
    ctx.fillRect(ax + 2, bcy - 14, tapeW - 4, 28);
    ctx.strokeStyle = "#57e6a9"; ctx.lineWidth = 2.5;
    ctx.strokeRect(ax + 2, bcy - 14, tapeW - 4, 28);
    ctx.fillStyle = "#57e6a9"; ctx.font = "bold 16px monospace"; ctx.textAlign = "center";
    ctx.fillText(String(Math.round(feet)), ax + tapeW / 2, bcy + 6);

    // Heading strip (bottom)
    const hy = H - 32;
    ctx.save();
    ctx.beginPath(); ctx.rect(4, hy, W - 8, 28); ctx.clip();
    ctx.fillStyle = "rgba(8,12,20,0.92)";
    ctx.fillRect(4, hy, W - 8, 28);
    const pxPerDeg = (W - 8) / 90;
    ctx.fillStyle = "#ffffff"; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center";
    ctx.strokeStyle = "#9fd8ff"; ctx.lineWidth = 2;
    const hStart = Math.floor((hdgDeg - 50) / 10) * 10;
    for (let hd = hStart; hd <= hdgDeg + 50; hd += 10) {
      const deg = ((hd % 360) + 360) % 360;
      const tx = W / 2 + (hd - hdgDeg) * pxPerDeg;
      ctx.beginPath(); ctx.moveTo(tx, hy + 18); ctx.lineTo(tx, hy + 26); ctx.stroke();
      if (deg % 90 === 0) {
        const names = { 0: "N", 90: "E", 180: "S", 270: "W" };
        ctx.fillStyle = deg === 0 ? "#ff5a4e" : "#ffffff";
        ctx.fillText(names[deg], tx, hy + 15);
        ctx.fillStyle = "#ffffff";
      } else if (deg % 30 === 0) {
        ctx.fillText(String(deg / 10), tx, hy + 15);
      }
    }
    ctx.restore();
    ctx.fillStyle = "#0b0e13";
    ctx.fillRect(W / 2 - 26, hy + 2, 52, 20);
    ctx.strokeStyle = "#57e6a9"; ctx.lineWidth = 2;
    ctx.strokeRect(W / 2 - 26, hy + 2, 52, 20);
    ctx.fillStyle = "#57e6a9"; ctx.font = "bold 15px monospace"; ctx.textAlign = "center";
    ctx.fillText(String(Math.round(hdgDeg)).padStart(3, "0"), W / 2, hy + 17);
  }

  // ---- ND: range rings, magenta route, rotating compass rose --------------
  function drawND(hdgDeg) {
    const ctx = nd.ctx;
    const W = nd.w, H = nd.h;
    ctx.fillStyle = "#05080e";
    ctx.fillRect(0, 0, W, H);
    screenTitle(ctx, W, "ND  40 NM");

    const cx = W / 2, cy = H / 2 + 10;
    // Range rings
    ctx.strokeStyle = "rgba(87,230,169,0.35)"; ctx.lineWidth = 2;
    for (const rr of [38, 74, 110]) {
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
    }
    // Magenta route with waypoints
    const wpts = [[cx - 72, cy + 66], [cx - 10, cy - 8], [cx + 56, cy - 72], [cx + 94, cy - 26]];
    ctx.strokeStyle = "#e65fd1"; ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(wpts[0][0], wpts[0][1]);
    for (let i = 1; i < wpts.length; i++) ctx.lineTo(wpts[i][0], wpts[i][1]);
    ctx.stroke();
    ctx.fillStyle = "#e65fd1"; ctx.font = "bold 13px sans-serif"; ctx.textAlign = "left";
    wpts.forEach(([wx, wy], i) => {
      ctx.beginPath(); ctx.arc(wx, wy, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillText("WPT" + (i + 1), wx + 6, wy - 8);
    });
    // Rotating compass rose
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-THREE.MathUtils.degToRad(hdgDeg));
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (let deg = 0; deg < 360; deg += 10) {
      const a = THREE.MathUtils.degToRad(deg) - Math.PI / 2;
      const major = deg % 30 === 0;
      ctx.strokeStyle = "#57e6a9"; ctx.lineWidth = major ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 112, Math.sin(a) * 112);
      ctx.lineTo(Math.cos(a) * (major ? 124 : 118), Math.sin(a) * (major ? 124 : 118));
      ctx.stroke();
      if (major) {
        const names = { 0: "N", 90: "E", 180: "S", 270: "W" };
        ctx.fillStyle = deg === 0 ? "#ff5a4e" : "#57e6a9";
        ctx.font = "bold 15px sans-serif";
        ctx.fillText(names[deg] || String(deg / 10), Math.cos(a) * 98, Math.sin(a) * 98);
      }
    }
    ctx.restore();
    ctx.textBaseline = "alphabetic";
    // Ownship triangle + lubber tick
    ctx.fillStyle = "#ffd75e";
    ctx.beginPath();
    ctx.moveTo(cx, cy - 14); ctx.lineTo(cx - 10, cy + 10); ctx.lineTo(cx + 10, cy + 10);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy - 128); ctx.lineTo(cx + 7, cy - 128); ctx.lineTo(cx, cy - 116);
    ctx.closePath(); ctx.fill();
  }

  // ---- Engine page: bar gauges + digital readouts --------------------------
  function drawENG(flight, fuel) {
    const ctx = eng.ctx;
    const W = eng.w, H = eng.h;
    ctx.fillStyle = "#05080e";
    ctx.fillRect(0, 0, W, H);
    screenTitle(ctx, W, "ENGINE");

    const n1 = 22 + flight.throttle * 78;    // %
    const egt = 380 + flight.throttle * 420; // deg C
    const ff = 4 + flight.throttle * 38;     // gal/h
    const bars = [n1 / 100, (egt - 300) / 600, ff / 45];
    const barText = [String(Math.round(n1)), String(Math.round(egt)), ff.toFixed(1)];
    const barLabels = ["N1", "EGT", "FF"];
    const barTop = 64, barH = 110;
    bars.forEach((frac, i) => {
      const bx = 34 + i * 92;
      ctx.fillStyle = "#bfe2ff"; ctx.font = "bold 17px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(barLabels[i], bx + 15, 52);
      ctx.fillStyle = "#111927";
      ctx.fillRect(bx, barTop, 30, barH);
      ctx.strokeStyle = "#4a5666"; ctx.lineWidth = 2;
      ctx.strokeRect(bx, barTop, 30, barH);
      ctx.strokeStyle = "#5a6a7d"; ctx.lineWidth = 1;
      for (let t = 0; t <= 4; t++) {
        const ty = barTop + t * (barH / 4);
        ctx.beginPath(); ctx.moveTo(bx + 31, ty); ctx.lineTo(bx + 37, ty); ctx.stroke();
      }
      const f = THREE.MathUtils.clamp(frac, 0, 1);
      const bh = barH * f;
      ctx.fillStyle = f > 0.9 ? "#ffb340" : "#2fbf71";
      ctx.fillRect(bx + 3, barTop + barH - bh, 24, bh);
      ctx.fillStyle = "#6df2b8"; ctx.font = "bold 18px monospace";
      ctx.fillText(barText[i], bx + 15, barTop + barH + 22);
    });

    const rpm = 650 + flight.throttle * 1950;
    const map = 10 + flight.throttle * 18;
    const oilT = 75 + flight.throttle * 45;
    const oilP = 40 + flight.throttle * 35;
    const rows = [
      "RPM  " + Math.round(rpm),
      "MAP  " + map.toFixed(1),
      "FUEL " + Math.round(fuel) + "%",
      "OIL T " + Math.round(oilT),
      "OIL P " + Math.round(oilP)
    ];
    ctx.fillStyle = "#e2efff"; ctx.font = "bold 16px monospace"; ctx.textAlign = "left";
    rows.forEach((row, i) => ctx.fillText(row, 24, 226 + i * 17));
    ctx.textAlign = "center";
  }

  // ---- Standby cluster: ASI, attitude, altimeter, heading (2x2) ------------
  function drawSTBY(flight, knots, feet, hdgDeg) {
    const ctx = stby.ctx;
    const W = stby.w, H = stby.h;
    ctx.fillStyle = "#05080e";
    ctx.fillRect(0, 0, W, H);
    screenTitle(ctx, W, "STANDBY");

    const R = 52;
    const ASI = [82, 104], ATT = [238, 104], ALT = [82, 238], HDG = [238, 238];

    // Airspeed indicator
    const asiTicks = [];
    for (let kt = 0; kt <= 200; kt += 20) {
      const showNum = kt % 40 === 0 && kt > 0 && kt < 200;
      asiTicks.push({ frac: kt / 200, major: true, text: showNum ? String(kt) : "" });
    }
    drawGaugeFace(ctx, ASI[0], ASI[1], R, "KT", asiTicks,
      { from: 60 / 200, to: 160 / 200, color: "#2fbf71" });
    drawNeedle(ctx, ASI[0], ASI[1], R, knots / 200);
    ctx.fillStyle = "#ffffff"; ctx.font = "bold 17px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(String(Math.round(knots)), ASI[0], ASI[1] + R * 0.9);

    // Attitude indicator (moving ball)
    ctx.fillStyle = "#2b333f";
    ctx.beginPath(); ctx.arc(ATT[0], ATT[1], R + 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#6b7a8d"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ATT[0], ATT[1], R + 4, 0, Math.PI * 2); ctx.stroke();
    ctx.save();
    ctx.beginPath(); ctx.arc(ATT[0], ATT[1], R, 0, Math.PI * 2); ctx.clip();
    ctx.translate(ATT[0], ATT[1]);
    ctx.rotate(-flight.roll);
    const pitchPx = THREE.MathUtils.clamp(flight.pitch, -0.8, 0.8) * 64;
    ctx.translate(0, pitchPx);
    ctx.fillStyle = "#3d8fd1"; ctx.fillRect(-R * 1.6, -R * 1.6, R * 3.2, R * 1.6);
    ctx.fillStyle = "#8a5a33"; ctx.fillRect(-R * 1.6, 0, R * 3.2, R * 1.6);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(-R * 1.6, -1.5, R * 3.2, 3);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (const off of [-26, -13, 13, 26]) {
      const len = Math.abs(off) === 13 ? 32 : 22;
      ctx.fillRect(-len / 2, off - 1, len, 2);
    }
    ctx.restore();
    ctx.strokeStyle = "#ffd75e"; ctx.lineWidth = 3.5; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(ATT[0] - 34, ATT[1]); ctx.lineTo(ATT[0] - 9, ATT[1]);
    ctx.moveTo(ATT[0] + 9, ATT[1]); ctx.lineTo(ATT[0] + 34, ATT[1]);
    ctx.stroke(); ctx.lineCap = "butt";
    ctx.fillStyle = "#ffd75e";
    ctx.beginPath(); ctx.arc(ATT[0], ATT[1], 3.5, 0, Math.PI * 2); ctx.fill();

    // Altimeter
    const altTicks = [];
    for (let f = 0; f < 10; f++) altTicks.push({ frac: f / 10, major: true, text: String(f) });
    drawGaugeFace(ctx, ALT[0], ALT[1], R, "", altTicks, null);
    drawNeedle(ctx, ALT[0], ALT[1], R, (feet % 1000) / 1000);
    ctx.fillStyle = "#0b0e13";
    ctx.fillRect(ALT[0] - 28, ALT[1] + 18, 56, 18);
    ctx.strokeStyle = "#4a5666"; ctx.lineWidth = 1.5;
    ctx.strokeRect(ALT[0] - 28, ALT[1] + 18, 56, 18);
    ctx.fillStyle = "#6df2b8"; ctx.font = "bold 15px monospace"; ctx.textAlign = "center";
    ctx.fillText(String(Math.round(feet)), ALT[0], ALT[1] + 31);

    // Heading indicator (rotating card)
    ctx.fillStyle = "#2b333f";
    ctx.beginPath(); ctx.arc(HDG[0], HDG[1], R + 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#6b7a8d"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(HDG[0], HDG[1], R + 4, 0, Math.PI * 2); ctx.stroke();
    ctx.save();
    ctx.beginPath(); ctx.arc(HDG[0], HDG[1], R, 0, Math.PI * 2); ctx.clip();
    const grad = ctx.createRadialGradient(HDG[0], HDG[1], R * 0.15, HDG[0], HDG[1], R);
    grad.addColorStop(0, "#1d2735"); grad.addColorStop(1, "#0a0f18");
    ctx.fillStyle = grad; ctx.fillRect(HDG[0] - R, HDG[1] - R, R * 2, R * 2);
    ctx.translate(HDG[0], HDG[1]);
    ctx.rotate(-THREE.MathUtils.degToRad(hdgDeg));
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (let deg = 0; deg < 360; deg += 15) {
      const a = THREE.MathUtils.degToRad(deg) - Math.PI / 2;
      const major = deg % 45 === 0;
      ctx.strokeStyle = "#e8f2ff"; ctx.lineWidth = major ? 2.5 : 1.2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (R - 3), Math.sin(a) * (R - 3));
      ctx.lineTo(Math.cos(a) * (R - (major ? 12 : 8)), Math.sin(a) * (R - (major ? 12 : 8)));
      ctx.stroke();
      if (deg % 90 === 0) {
        const names = { 0: "N", 90: "E", 180: "S", 270: "W" };
        ctx.fillStyle = deg === 0 ? "#ff6a5e" : "#ffffff";
        ctx.font = "bold 15px sans-serif";
        ctx.fillText(names[deg], Math.cos(a) * (R - 22), Math.sin(a) * (R - 22));
      }
    }
    ctx.restore();
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#ffd75e";
    ctx.beginPath();
    ctx.moveTo(HDG[0] - 6, HDG[1] - R + 1); ctx.lineTo(HDG[0] + 6, HDG[1] - R + 1);
    ctx.lineTo(HDG[0], HDG[1] - R + 11);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#ffd75e"; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(HDG[0] - 18, HDG[1]); ctx.lineTo(HDG[0] + 18, HDG[1]);
    ctx.moveTo(HDG[0], HDG[1] - 11); ctx.lineTo(HDG[0], HDG[1] + 9);
    ctx.stroke(); ctx.lineCap = "butt";
  }

  // ---- Per-frame update ------------------------------------------------------
  function update(flight, fuel) {
    const knots = flight.speed * 1.94;
    const feet = flight.position.y * 3.28;
    const hdgDeg = ((THREE.MathUtils.radToDeg(flight.heading) % 360) + 360) % 360;

    drawPFD(flight, knots, feet, hdgDeg);
    drawND(hdgDeg);
    drawENG(flight, fuel);
    drawSTBY(flight, knots, feet, hdgDeg);
    pfd.texture.needsUpdate = true;
    nd.texture.needsUpdate = true;
    eng.texture.needsUpdate = true;
    stby.texture.needsUpdate = true;

    // Annunciator lamps: LOW FUEL, STALL, GEAR, OIL, ALT.
    const oilP = 40 + flight.throttle * 35;
    const lit = [
      fuel < 25,
      !flight.onGround && flight.speed < 26,
      flight.onGround,
      oilP < 45,
      flight.throttle < 0.05 && !flight.onGround
    ];
    for (let i = 0; i < 5; i++) {
      lampMats[i].color.setHex(lit[i] ? lampColors[i] : 0x232b36);
    }

    // Yoke: wheel rolls with bank, column shifts with pitch.
    wheel.rotation.z = -THREE.MathUtils.clamp(flight.roll, -1.2, 1.2) * 0.85;
    const pitchC = THREE.MathUtils.clamp(flight.pitch, -0.6, 0.6);
    yoke.position.set(
      YOKE_BASE.x,
      YOKE_BASE.y - pitchC * 0.05,
      YOKE_BASE.z + pitchC * 0.1
    );
  }

  // Draw one idle frame so the screens are never black on first show.
  update(
    {
      speed: 0, pitch: 0, roll: 0, heading: 0, throttle: 0,
      onGround: true, verticalSpeed: 0,
      position: new THREE.Vector3(0, 17, 240)
    },
    100
  );

  return { group, update };
}
