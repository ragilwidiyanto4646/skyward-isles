// aircraft.js — original stylized low-poly prop plane built from primitives.
import * as THREE from "three";

export function buildAircraft() {
  const plane = new THREE.Group();
  const red = new THREE.MeshLambertMaterial({ color: 0xe63b2e });
  const cream = new THREE.MeshLambertMaterial({ color: 0xf7ead0 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
  const glass = new THREE.MeshPhongMaterial({ color: 0x9fd8ff, shininess: 120, specular: 0xffffff });

  // Fuselage: tapered body along Z (nose toward -Z).
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 0.75, 11, 10), red);
  body.rotation.x = Math.PI / 2;
  plane.add(body);

  const nose = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.5, 1.4, 10), cream);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = -5.9;
  plane.add(nose);

  // Canopy.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.25, 12, 10), glass);
  canopy.scale.set(0.95, 0.75, 1.7);
  canopy.position.set(0, 1.05, -1.2);
  plane.add(canopy);

  // Main wing (low wing) with cream tips.
  const wing = new THREE.Mesh(new THREE.BoxGeometry(15.5, 0.35, 2.6), red);
  wing.position.set(0, -0.55, -1.4);
  plane.add(wing);
  for (const side of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 2.65), cream);
    tip.position.set(side * 7.4, -0.55, -1.4);
    plane.add(tip);
  }

  // Tail: horizontal stabilizer + vertical fin.
  const hTail = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.3, 1.7), red);
  hTail.position.set(0, 0.35, 5.2);
  plane.add(hTail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.6, 2.2), red);
  fin.position.set(0, 1.3, 5.2);
  plane.add(fin);
  const finTip = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.7, 2.25), cream);
  finTip.position.set(0, 2.35, 5.2);
  plane.add(finTip);

  // Landing gear: two main wheels + struts, small tail wheel.
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.9, 6), dark);
    strut.position.set(side * 1.7, -1.6, -1.6);
    strut.rotation.z = side * 0.25;
    plane.add(strut);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.4, 10), dark);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(side * 1.95, -2.5, -1.6);
    plane.add(wheel);
  }
  const tailWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.25, 8), dark);
  tailWheel.rotation.z = Math.PI / 2;
  tailWheel.position.set(0, -0.85, 5.0);
  plane.add(tailWheel);

  // Propeller: spinner + two blades, spins around Z.
  const prop = new THREE.Group();
  prop.position.set(0, 0, -6.9);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.3, 10), cream);
  spinner.rotation.x = -Math.PI / 2;
  prop.add(spinner);
  const bladeGeo = new THREE.BoxGeometry(0.55, 4.6, 0.12);
  const blade1 = new THREE.Mesh(bladeGeo, dark);
  prop.add(blade1);
  const blade2 = new THREE.Mesh(bladeGeo, dark);
  blade2.rotation.z = Math.PI / 2;
  prop.add(blade2);
  // Translucent blur disc so the spinning prop reads at a glance.
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(2.45, 24),
    new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.16, side: THREE.DoubleSide })
  );
  prop.add(disc);
  plane.add(prop);

  // Navigation lights: red left, green right, white tail.
  const mkLight = (color, x, y, z) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color }));
    s.position.set(x, y, z);
    plane.add(s);
  };
  mkLight(0xff2222, -7.8, -0.55, -1.4);
  mkLight(0x22ff66, 7.8, -0.55, -1.4);
  mkLight(0xffffff, 0, 0.4, 6.1);

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
