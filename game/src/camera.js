// camera.js — smooth chase camera and cockpit view.
import * as THREE from "three";

export function createCameras() {
  const chasePos = new THREE.Vector3(0, 30, 280);
  const lookAt = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const euler = new THREE.Euler();
  const quat = new THREE.Quaternion();
  let mode = "chase"; // "chase" | "cockpit"

  return {
    get mode() { return mode; },
    toggle() { mode = mode === "chase" ? "cockpit" : "chase"; return mode; },
    setMode(m) { mode = m; },

    update(camera, flight, planeMesh, dt, snap = false) {
      if (mode === "cockpit") {
        // Sit just behind the canopy, looking along the nose.
        offset.set(0, 1.7, 0.6).applyQuaternion(planeMesh.quaternion);
        camera.position.copy(planeMesh.position).add(offset);
        euler.set(flight.pitch, flight.heading, flight.roll * 0.85, "YXZ");
        quat.setFromEuler(euler);
        camera.quaternion.copy(quat);
        planeMesh.visible = false;
        return;
      }
      planeMesh.visible = true;
      // Chase: behind and above the plane, in heading space (not rolled).
      euler.set(0, flight.heading, 0, "YXZ");
      quat.setFromEuler(euler);
      offset.set(0, 6.5, 26).applyQuaternion(quat);
      desired.copy(planeMesh.position).add(offset);
      // Never sink the camera under terrain or water.
      desired.y = Math.max(desired.y, 4);
      if (snap) chasePos.copy(desired);
      else chasePos.lerp(desired, Math.min(1, dt * 3.2));
      camera.position.copy(chasePos);
      lookAt.copy(planeMesh.position);
      lookAt.y += 2.2;
      // Look slightly ahead of the plane so rings ahead stay in frame.
      lookAt.addScaledVector(flight.forward, 18);
      camera.lookAt(lookAt);
    }
  };
}
