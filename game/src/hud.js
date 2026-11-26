// hud.js — DOM instruments: altitude, airspeed, vertical speed, compass
// strip, artificial horizon, throttle/fuel bars, mission progress and
// distance to the next checkpoint, gear status.
//
// Two layouts share this code (see index.html):
//   - chase / free views: the full HUD.
//   - cockpit view: a compact layout (.cockpit class on #hud). The real 3D
//     panel from cockpit3d.js is live there, so the DOM HUD shrinks and
//     moves clear of the overhead switches and standby instruments.
import * as THREE from "three";
import { RING_COURSE } from "./missions.js";
import { RUNWAYS } from "./terrain.js";

export function createHud() {
  const el = (id) => document.getElementById(id);
  const hudEl = el("hud");
  const altVal = el("altVal"), spdVal = el("spdVal"), thrVal = el("thrVal");
  const vsiVal = el("vsiVal");
  const fuelVal = el("fuelVal"), fuelBar = el("fuelBar"), throttleBar = el("throttleBar");
  const hdgVal = el("hdgVal"), scoreVal = el("scoreVal"), timerVal = el("timerVal");
  const missionTitle = el("missionTitle"), missionText = el("missionText"), missionSub = el("missionSub");
  const missionMeta = el("missionMeta"), ringVal = el("ringVal"), distVal = el("distVal");
  const viewVal = el("viewVal"), centerMsg = el("centerMsg");
  const compassCtx = el("compass").getContext("2d");
  const horizonCtx = el("horizon").getContext("2d");
  const cockpitCanvas = el("cockpitFrame");

  let msgTimer = 0;
  const _target = new THREE.Vector3();

  function fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ":" + String(s).padStart(2, "0");
  }

  // Signed feet-per-minute, e.g. "+320" / "-150" / "+0".
  function fmtVsi(fpm) {
    const v = Math.round(fpm);
    return (v >= 0 ? "+" : "") + v;
  }

  function drawCompass(headingDeg) {
    const w = 420, h = 34;
    compassCtx.clearRect(0, 0, w, h);
    compassCtx.fillStyle = "rgba(10,30,55,0.9)";
    compassCtx.fillRect(0, 0, w, h);
    compassCtx.font = "bold 15px sans-serif";
    compassCtx.textAlign = "center";
    const pxPerDeg = 2.2;
    const startDeg = Math.floor((headingDeg - 95) / 5) * 5;
    for (let degAbs = startDeg; degAbs <= headingDeg + 95; degAbs += 5) {
      const deg = ((degAbs % 360) + 360) % 360;
      const x = w / 2 + (degAbs - headingDeg) * pxPerDeg;
      if (deg % 45 === 0) {
        const names = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
        compassCtx.fillStyle = deg === 0 ? "#ff5a4e" : "#ffffff";
        compassCtx.fillText(names[deg], x, 15);
        compassCtx.fillRect(x - 1, 19, 2, 8);
      } else if (deg % 15 === 0) {
        compassCtx.fillStyle = "#9fd8ff";
        compassCtx.fillRect(x - 1, 22, 2, 6);
      }
    }
    compassCtx.fillStyle = "#ffd75e";
    compassCtx.beginPath();
    compassCtx.moveTo(w / 2 - 7, 0); compassCtx.lineTo(w / 2 + 7, 0); compassCtx.lineTo(w / 2, 9);
    compassCtx.closePath(); compassCtx.fill();
  }

  function drawHorizon(pitch, roll) {
    const s = 150, c = s / 2;
    horizonCtx.save();
    horizonCtx.clearRect(0, 0, s, s);
    horizonCtx.beginPath();
    horizonCtx.arc(c, c, c - 2, 0, Math.PI * 2);
    horizonCtx.clip();
    horizonCtx.translate(c, c);
    horizonCtx.rotate(-roll);
    const pitchPx = THREE.MathUtils.clamp(pitch, -0.8, 0.8) * 90;
    horizonCtx.translate(0, pitchPx);
    horizonCtx.fillStyle = "#3d8fd1";
    horizonCtx.fillRect(-s, -s, s * 2, s);
    horizonCtx.fillStyle = "#8a5a33";
    horizonCtx.fillRect(-s, 0, s * 2, s);
    horizonCtx.fillStyle = "#ffffff";
    horizonCtx.fillRect(-s, -1.5, s * 2, 3);
    horizonCtx.restore();
    // Fixed aircraft symbol.
    horizonCtx.strokeStyle = "#ffd75e";
    horizonCtx.lineWidth = 4;
    horizonCtx.beginPath();
    horizonCtx.moveTo(c - 38, c); horizonCtx.lineTo(c - 10, c);
    horizonCtx.moveTo(c + 10, c); horizonCtx.lineTo(c + 38, c);
    horizonCtx.stroke();
    horizonCtx.fillStyle = "#ffd75e";
    horizonCtx.beginPath();
    horizonCtx.arc(c, c, 4, 0, Math.PI * 2);
    horizonCtx.fill();
  }

  // Mission progress line: ring count + distance to the next ring (3D), or
  // horizontal distance to the Far Strip on Island Hop. Hidden in free
  // flight, where there is no checkpoint.
  function updateMissionMeta(flight, mission) {
    if (mission.kind === "ring") {
      const total = mission.ringsTotal;
      ringVal.textContent = "RING " + Math.min(mission.nextRing + 1, total) + "/" + total;
      if (mission.nextRing < total) {
        const p = RING_COURSE[mission.nextRing];
        _target.set(p.x, p.y, p.z);
        distVal.textContent = Math.round(flight.position.distanceTo(_target)) + " m";
      } else {
        distVal.textContent = "—";
      }
      missionMeta.style.display = "";
    } else if (mission.kind === "hop") {
      const target = RUNWAYS[1];
      ringVal.textContent = "FAR STRIP";
      const d = Math.hypot(flight.position.x - target.x, flight.position.z - target.z);
      distVal.textContent = Math.round(d) + " m";
      missionMeta.style.display = "";
    } else {
      missionMeta.style.display = "none";
    }
  }

  return {
    show() { hudEl.classList.remove("hidden"); },
    hide() { hudEl.classList.add("hidden"); },
    // The 2D cockpitFrame overlay is retired (cockpit view renders the real
    // 3D cockpit); this keeps the hidden canvas element's toggle working.
    setCockpitVisible(v) { cockpitCanvas.classList.toggle("hidden", !v); },
    flashMessage(text, seconds = 2.2) {
      centerMsg.textContent = text;
      msgTimer = seconds;
    },
    update(flight, mission, cameraMode, dt) {
      altVal.textContent = String(Math.round(flight.position.y * 3.28));
      spdVal.textContent = String(Math.round(flight.speed * 1.94));
      vsiVal.textContent = fmtVsi(flight.verticalSpeed * 196.85);
      thrVal.textContent = String(Math.round(flight.throttle * 100));
      throttleBar.style.width = (flight.throttle * 100) + "%";
      fuelVal.textContent = String(Math.round(mission.fuel));
      fuelBar.style.width = mission.fuel + "%";
      fuelBar.style.background = mission.fuel > 25 ? "#ffb340" : "#ff5a4e";
      const hdg = ((THREE.MathUtils.radToDeg(flight.heading) % 360) + 360) % 360;
      hdgVal.textContent = String(Math.round(hdg)).padStart(3, "0");
      scoreVal.textContent = String(mission.score);
      timerVal.textContent = fmtTime(mission.elapsed);
      missionTitle.textContent = mission.title;
      missionText.textContent = mission.objective;
      missionSub.textContent = mission.detail;
      updateMissionMeta(flight, mission);
      viewVal.textContent =
        cameraMode === "cockpit" ? "COCKPIT" :
        cameraMode === "free" ? "FREE CAM" : "CHASE CAM";
      // Compact layout in cockpit view so the DOM HUD clears the 3D
      // overhead panel and standby instruments (see .cockpit in index.html).
      hudEl.classList.toggle("cockpit", cameraMode === "cockpit");
      drawCompass(hdg);
      // The DOM horizon is hidden in cockpit view (the 3D PFD carries
      // attitude there), so skip drawing it.
      if (cameraMode !== "cockpit") drawHorizon(flight.pitch, flight.roll);
      if (msgTimer > 0) {
        msgTimer -= dt;
        if (msgTimer <= 0) centerMsg.textContent = "";
      }
    }
  };
}
