// aircraft.js — original stylized low-poly prop plane, shaped geometry.
//
// The airframe is built from lathed and extruded shapes rather than plain
// boxes: a lathe-profile fuselage (rounded cowl, wide cabin, tapering tail
// cone), tapered wings with dihedral extruded from a planform outline, a
// swept vertical fin, and a glass canopy bubble. Red / cream livery, nose
// toward -Z. The public contract is unchanged: buildAircraft() returns a
// THREE.Group with userData.prop (Group) and userData.disc (Mesh), and
// spinPropeller(plane, throttle, dt) spins the prop faster with throttle.
import * as THREE from "three";

const RED = 0xe63b2e;
const CREAM = 0xf7ead0;
const DARK = 0x2b2f36;

// ---------------------------------------------------------------------------
// Small geometry helpers
// ---------------------------------------------------------------------------

// Lathe a (radius, station) profile around the Y axis, then lay it along Z
// so station 0 (tail) sits at +Z and the last station (nose) at -Z. The
// cross-section is squeezed a little narrower than tall, like a real cabin.
// `zShift` moves the whole body so the cabin lands near the origin.
function latheBody(profile, material, zShift) {
  const points = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(points, 14);
  geo.scale(0.88, 1, 1.06);          // narrower (x) than tall (z -> up)
  geo.rotateX(-Math.PI / 2);         // +Y (toward nose) -> -Z
  geo.translate(0, 0, zShift);
  return new THREE.Mesh(geo, material);
}

// Extrude a flat planform outline (x = span, y = chord, +y toward the
// trailing edge) into a wing slab of the given thickness, lying in the XZ
// plane with the leading edge toward -Z.
function extrudePlanform(outline, thickness, material) {
  const shape = new THREE.Shape();
  shape.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) shape.lineTo(outline[i][0], outline[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);          // shape +y -> +Z (tail), extrusion -> -Y
  geo.translate(0, thickness / 2, 0);
  return new THREE.Mesh(geo, material);
}

// One tapered wing half, split into a red inner panel and a cream tip panel.
// Chord shrinks from root to tip and the leading edge sweeps back a little,
// so the half reads as a wing rather than a slab. `side` is +1 (right, +X)
// or -1 (left, -X); the outline winding is flipped for the left half so the
// faces keep pointing outward.
function wingHalf(side, opts, redMat, creamMat) {
  const { halfSpan, rootChord, tipChord, sweep, thickness, tipStart } = opts;
  const group = new THREE.Group();

  const leadingEdgeY = (s) => -rootChord / 2 + sweep * (s / halfSpan);
  const chordAt = (s) => rootChord + (tipChord - rootChord) * (s / halfSpan);
  const panel = (s0, s1, material) => {
    const outline = [
      [side * s0, leadingEdgeY(s0)],
      [side * s1, leadingEdgeY(s1)],
      [side * s1, leadingEdgeY(s1) + chordAt(s1)],
      [side * s0, leadingEdgeY(s0) + chordAt(s0)]
    ];
    if (side < 0) outline.reverse();
    return extrudePlanform(outline, thickness, material);
  };

  group.add(panel(0, tipStart, redMat));
  group.add(panel(tipStart, halfSpan, creamMat));
  return group;
}

// A symmetric pair of tapered wing halves with dihedral (tips raised).
function taperedWing(opts, redMat, creamMat) {
  const group = new THREE.Group();
  for (const side of [-1, 1]) {
    const half = wingHalf(side, opts, redMat, creamMat);
    half.rotation.z = side * opts.dihedral;
    group.add(half);
  }
  return group;
}

// A strut (cylinder) stretched between two points — used for landing gear.
function strutBetween(a, b, radius, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 8), material);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

// A wheel: torus tyre with a cream hub disc, axle along X.
function makeWheel(tyreR, tubeR, hubR, darkMat, creamMat) {
  const wheel = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.TorusGeometry(tyreR, tubeR, 8, 16), darkMat);
  tyre.rotation.y = Math.PI / 2;
  wheel.add(tyre);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, tubeR * 1.7, 10), creamMat);
  hub.rotation.z = Math.PI / 2;
  wheel.add(hub);
  return wheel;
}

// ---------------------------------------------------------------------------
// The aircraft
// ---------------------------------------------------------------------------

export function buildAircraft() {
  const plane = new THREE.Group();
  const red = new THREE.MeshLambertMaterial({ color: RED });
  const cream = new THREE.MeshLambertMaterial({ color: CREAM });
  const dark = new THREE.MeshLambertMaterial({ color: DARK });
  const glass = new THREE.MeshPhongMaterial({ color: 0x9fd8ff, shininess: 120, specular: 0xffffff });

  // --- Fuselage: lathe profile, tail (station 0) to nose (station 12.5). ---
  // Rounded engine cowl up front, widest at the cabin (stations ~7.6-8.6),
  // then a long tapering tail cone.
  const fuselageProfile = [
    [0.05, 0.0], [0.35, 0.6], [0.55, 1.6], [0.78, 3.0], [1.05, 4.6],
    [1.32, 6.2], [1.48, 7.6], [1.50, 8.6], [1.46, 9.6], [1.38, 10.6],
    [1.20, 11.4], [0.85, 12.0], [0.40, 12.35], [0.05, 12.5]
  ];
  plane.add(latheBody(fuselageProfile, red, 6.2));

  // Cream engine cowl band wrapped over the nose stations.
  const cowlProfile = [
    [1.40, 10.35], [1.42, 10.9], [1.30, 11.5], [0.95, 12.05], [0.45, 12.38], [0.06, 12.52]
  ];
  plane.add(latheBody(cowlProfile, cream, 6.2));

  // Cream cheatline ring just behind the cabin.
  const stripeProfile = [[1.52, 6.55], [1.53, 6.95], [1.52, 7.3]];
  plane.add(latheBody(stripeProfile, cream, 6.2));

  // --- Canopy: glass bubble on the spine with a red skirt and headrest. ---
  const canopySkirt = new THREE.Mesh(new THREE.CylinderGeometry(1.02, 1.12, 0.55, 12), red);
  canopySkirt.scale.set(0.85, 1, 1.5);
  canopySkirt.position.set(0, 0.98, -1.55);
  plane.add(canopySkirt);

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.15, 14, 10), glass);
  canopy.scale.set(0.82, 0.62, 1.55);
  canopy.position.set(0, 1.12, -1.55);
  plane.add(canopy);

  // Slim centre pillar over the glass.
  const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 2.6), red);
  pillar.position.set(0, 1.78, -1.55);
  plane.add(pillar);

  // Headrest fairing tapering from the canopy into the spine.
  const fairing = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.2, 8), red);
  fairing.scale.set(0.8, 1, 0.75);
  fairing.rotation.x = Math.PI / 2 + 0.18;
  fairing.position.set(0, 1.15, 0.75);
  plane.add(fairing);

  // --- Main wing: tapered, slight dihedral, cream tips. Low wing. ---
  const wing = taperedWing(
    { halfSpan: 7.75, rootChord: 2.9, tipChord: 1.7, sweep: 0.55, thickness: 0.3, tipStart: 6.0, dihedral: 0.085 },
    red, cream
  );
  wing.position.set(0, -0.5, -1.3);
  plane.add(wing);

  // --- Tail: tapered horizontal stabilizer + swept vertical fin. ---
  const tailplane = taperedWing(
    { halfSpan: 2.9, rootChord: 1.8, tipChord: 1.15, sweep: 0.3, thickness: 0.22, tipStart: 2.2, dihedral: 0.02 },
    red, cream
  );
  tailplane.position.set(0, 0.3, 4.9);
  plane.add(tailplane);

  // Vertical fin: side profile (x toward nose, y up) extruded across X.
  // Built in two stacked slices so the tip can wear the cream livery.
  const finSlice = (outline, material) => {
    const shape = new THREE.Shape();
    shape.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i++) shape.lineTo(outline[i][0], outline[i][1]);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.24, bevelEnabled: false });
    geo.rotateY(Math.PI / 2);        // shape +x -> -Z (nose), extrusion -> +X
    geo.translate(-0.12, 0, 0);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(0, 0, 4.7);
    return mesh;
  };
  // Lower fin (red): swept leading edge from the spine up to the cream slice.
  plane.add(finSlice([[1.6, 0.45], [0.53, 2.1], [-1.22, 2.1], [-1.5, 0.45]], red));
  // Upper fin (cream tip) with a rounded top corner.
  const finTop = new THREE.Shape();
  finTop.moveTo(0.53, 2.1);
  finTop.lineTo(0.22, 2.55);
  finTop.quadraticCurveTo(0.05, 2.78, -0.35, 2.8);
  finTop.lineTo(-1.1, 2.75);
  finTop.lineTo(-1.22, 2.1);
  finTop.closePath();
  const finTopGeo = new THREE.ExtrudeGeometry(finTop, { depth: 0.24, bevelEnabled: false });
  finTopGeo.rotateY(Math.PI / 2);
  finTopGeo.translate(-0.12, 0, 0);
  const finTip = new THREE.Mesh(finTopGeo, cream);
  finTip.position.set(0, 0, 4.7);
  plane.add(finTip);

  // --- Landing gear: two sprung mains under the wing roots + tail wheel. ---
  // Main wheel bottoms sit at y = -2.62, matching the flight model's gear
  // offset (ground + 2.6) so the tyres just touch the runway.
  for (const side of [-1, 1]) {
    const top = new THREE.Vector3(side * 1.05, -1.15, -1.7);
    const axle = new THREE.Vector3(side * 1.6, -2.0, -1.7);
    plane.add(strutBetween(top, axle, 0.15, dark));
    // Short drag brace from the fuselage belly to the axle.
    plane.add(strutBetween(new THREE.Vector3(side * 0.55, -1.35, -0.85), axle, 0.09, dark));
    const wheel = makeWheel(0.42, 0.2, 0.3, dark, cream);
    wheel.position.copy(axle);
    plane.add(wheel);
  }
  plane.add(strutBetween(new THREE.Vector3(0, -0.45, 4.85), new THREE.Vector3(0, -1.2, 5.05), 0.09, dark));
  const tailWheel = makeWheel(0.22, 0.11, 0.15, dark, cream);
  tailWheel.position.set(0, -1.28, 5.05);
  plane.add(tailWheel);

  // --- Propeller: cream spinner, shaped blades, translucent blur disc. ---
  const prop = new THREE.Group();
  prop.position.set(0, 0, -6.55);

  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.52, 1.3, 12), cream);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -0.4;
  prop.add(spinner);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.4, 10), dark);
  hub.rotation.x = Math.PI / 2;
  prop.add(hub);

  // Blade outline: narrow root, wide paddle mid-span, rounded tip.
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-0.09, 0.2);
  bladeShape.lineTo(-0.17, 0.9);
  bladeShape.lineTo(-0.19, 1.7);
  bladeShape.quadraticCurveTo(-0.19, 2.3, 0, 2.38);
  bladeShape.quadraticCurveTo(0.19, 2.3, 0.19, 1.7);
  bladeShape.lineTo(0.17, 0.9);
  bladeShape.lineTo(0.09, 0.2);
  bladeShape.closePath();
  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.09, bevelEnabled: false });
  bladeGeo.translate(0, 0, -0.045);
  for (const flip of [0, Math.PI]) {
    const blade = new THREE.Mesh(bladeGeo, dark);
    blade.rotation.order = "ZYX";
    blade.rotation.z = flip;
    blade.rotation.y = 0.5;          // blade pitch
    prop.add(blade);
  }

  // Translucent blur disc so the spinning prop reads at a glance.
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(2.45, 24),
    new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.16, side: THREE.DoubleSide })
  );
  prop.add(disc);
  plane.add(prop);

  // --- Small details: exhaust stub, pitot tube, antenna mast. ---
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.7, 6), dark);
  exhaust.rotation.x = Math.PI / 2 - 0.35;
  exhaust.position.set(0.95, -0.85, -5.3);
  plane.add(exhaust);

  const pitot = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 5), dark);
  pitot.rotation.x = Math.PI / 2;
  pitot.position.set(-3.4, -0.72, -2.9);
  plane.add(pitot);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.85, 5), dark);
  mast.position.set(0, 1.95, 0.4);
  plane.add(mast);

  // --- Navigation lights: red left, green right, white tail. ---
  const mkLight = (color, x, y, z) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color }));
    s.position.set(x, y, z);
    plane.add(s);
  };
  mkLight(0xff2222, -7.82, 0.18, -1.35);
  mkLight(0x22ff66, 7.82, 0.18, -1.35);
  mkLight(0xffffff, 0, 0.35, 6.25);

  plane.userData.prop = prop;
  plane.userData.disc = disc;
  return plane;
}

// Spin the propeller; faster with throttle, disc fades in when spinning.
export function spinPropeller(plane, throttle, dt) {
  const prop = plane.userData.prop;
  const speed = 2 + throttle * 55;
  prop.rotation.z += speed * dt;
  plane.userData.disc.material.opacity = throttle > 0.05 ? 0.18 : 0.05;
}
