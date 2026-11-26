// camera.js — chase camera, cockpit view, and a free-orbit camera.
//
// Modes cycle chase -> cockpit -> free -> chase on the view toggle.
//   chase:   smooth lerp behind/above the plane in heading space (default).
//   cockpit: pilot position looking along the nose, airframe mesh hidden.
//   free:    spherical orbit around the aircraft — drag the mouse to orbit,
//            wheel to zoom; after a few idle seconds it slowly auto-orbits
//            so the plane can be admired hands-free. The orbit distance is
//            clamped so the camera never clips into the mesh.
import * as THREE from "three";
import { heightAt } from "./terrain.js";

const FREE_MIN_DIST = 14;   // outside the wingtips (half-span 7.75) + margin
const FREE_MAX_DIST = 60;
const FREE_MIN_POLAR = -0.15;  // elevation, radians (slightly below level)
const FREE_MAX_POLAR = 1.35;   // nearly overhead
const FREE_AUTO_ORBIT = 0.12;  // rad/s once idle
const FREE_IDLE_DELAY = 3;     // seconds of no drag before auto-orbit

export function createCameras() {
  const chasePos = new THREE.Vector3(0, 30, 280);
  const lookAt = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const euler = new THREE.Euler();
  const quat = new THREE.Quaternion();
  let mode = "chase"; // "chase" | "cockpit" | "free"

  // Free-orbit state: azimuth 0 = behind the plane (same spot as chase),
  // polar = elevation above the horizontal plane, dist = orbit radius.
  let freeAz = 0;
  let freePol = 0.22;
  let freeDist = 26;
  let freeIdle = 0;
  let prevMode = "chase";

  return {
    get mode() { return mode; },
    toggle() {
      mode = mode === "chase" ? "cockpit" : mode === "cockpit" ? "free" : "chase";
      return mode;
    },
    setMode(m) { mode = m; },
    // Set the free-orbit angles directly (used by screenshot staging).
    setFreeOrbit(az, pol, dist) {
      freeAz = az;
      freePol = THREE.MathUtils.clamp(pol, FREE_MIN_POLAR, FREE_MAX_POLAR);
      freeDist = THREE.MathUtils.clamp(dist, FREE_MIN_DIST, FREE_MAX_DIST);
      freeIdle = 0;
    },
    getFreeOrbit() { return { az: freeAz, pol: freePol, dist: freeDist }; },

    update(camera, flight, planeMesh, dt, snap = false, input = null) {
      // Cockpit mode gets a wider field of view so the windshield view
      // opens up; chase and free keep the standard 62 degrees. Applied
      // here, per frame, so the widening can never leak into other modes.
      const targetFov = mode === "cockpit" ? 68 : 62;
      if (camera.fov !== targetFov) {
        camera.fov = targetFov;
        camera.updateProjectionMatrix();
      }
      if (mode === "cockpit") {
        // Sit just behind the canopy, looking along the nose.
        offset.set(0, 1.7, 0.6).applyQuaternion(planeMesh.quaternion);
        camera.position.copy(planeMesh.position).add(offset);
        euler.set(flight.pitch, flight.heading, flight.roll * 0.85, "YXZ");
        quat.setFromEuler(euler);
        camera.quaternion.copy(quat);
        planeMesh.visible = false;
        prevMode = mode;
        return;
      }
      planeMesh.visible = true;

      if (mode === "free") {
        // Mouse drag orbits, wheel zooms (deltas arrive via input.poll()).
        let dragged = false;
        if (input) {
          if (input.orbitDX || input.orbitDY) {
            freeAz -= input.orbitDX * 0.005;
            freePol += input.orbitDY * 0.005;
            dragged = true;
          }
          if (input.orbitZoom) {
            freeDist += input.orbitZoom * 2.5;
            dragged = true;
          }
        }
        freePol = THREE.MathUtils.clamp(freePol, FREE_MIN_POLAR, FREE_MAX_POLAR);
        freeDist = THREE.MathUtils.clamp(freeDist, FREE_MIN_DIST, FREE_MAX_DIST);
        freeIdle = dragged ? 0 : freeIdle + dt;
        if (freeIdle > FREE_IDLE_DELAY) freeAz += FREE_AUTO_ORBIT * dt;

        // Spherical offset in heading space so "side view" stays side-on
        // while the plane flies straight.
        euler.set(0, flight.heading, 0, "YXZ");
        quat.setFromEuler(euler);
        const cp = Math.cos(freePol);
        offset.set(
          Math.sin(freeAz) * cp,
          Math.sin(freePol),
          Math.cos(freeAz) * cp
        ).multiplyScalar(freeDist).applyQuaternion(quat);
        desired.copy(planeMesh.position).add(offset);
        // Never sink the camera under terrain or water.
        desired.y = Math.max(desired.y, heightAt(desired.x, desired.z) + 1.2, 4);
        // Snap on the first free frame after another mode so the view
        // doesn't swing across the world; lerp afterwards for smoothness.
        // Exponential form keeps the follow time constant the same at any
        // frame rate (a plain dt*k factor drifts with fps and can overshoot).
        if (snap || prevMode !== "free") chasePos.copy(desired);
        else chasePos.lerp(desired, 1 - Math.exp(-dt * 3.2));
        camera.position.copy(chasePos);
        lookAt.copy(planeMesh.position);
        lookAt.y += 1.2;
        camera.lookAt(lookAt);
        prevMode = mode;
        return;
      }

      // Chase: behind and above the plane, in heading space (not rolled).
      euler.set(0, flight.heading, 0, "YXZ");
      quat.setFromEuler(euler);
      offset.set(0, 6.5, 26).applyQuaternion(quat);
      desired.copy(planeMesh.position).add(offset);
      // Never sink the camera under terrain or water.
      desired.y = Math.max(desired.y, heightAt(desired.x, desired.z) + 1.2, 4);
      if (snap) chasePos.copy(desired);
      else chasePos.lerp(desired, 1 - Math.exp(-dt * 3.2));
      camera.position.copy(chasePos);
      lookAt.copy(planeMesh.position);
      lookAt.y += 2.2;
      // Look slightly ahead of the plane so rings ahead stay in frame.
      lookAt.addScaledVector(flight.forward, 18);
      camera.lookAt(lookAt);
      prevMode = mode;
    }
  };
}
