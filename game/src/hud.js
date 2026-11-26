// hud.js — DOM instruments: altitude, speed, compass strip, artificial horizon, fuel.
import * as THREE from "three";

export function createHud() {
  const el = (id) => document.getElementById(id);
  const altVal = el("altVal"), spdVal = el("spdVal"), thrVal = el("thrVal");
  const fuelVal = el("fuelVal"), fuelBar = el("fuelBar"), throttleBar = el("throttleBar");
  const hdgVal = el("hdgVal"), scoreVal = el("scoreVal"), timerVal = el("timerVal");
  const missionTitle = el("missionTitle"), missionText = el("missionText"), missionSub = el("missionSub");
  const viewVal = el("viewVal"), centerMsg = el("centerMsg");
  const compassCtx = el("compass").getContext("2d");
  const horizonCtx = el("horizon").getContext("2d");
  const cockpitCanvas = el("cockpitFrame");
  const cockpitCtx = cockpitCanvas.getContext("2d");

  let msgTimer = 0;

  function fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ":" + String(s).padStart(2, "0");
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

  function drawCockpitFrame(flight, fuel) {
    const w = cockpitCanvas.width, h = cockpitCanvas.height;
    cockpitCtx.clearRect(0, 0, w, h);
    // Dashboard across the bottom third.
    cockpitCtx.fillStyle = "#1c222b";
    cockpitCtx.beginPath();
    cockpitCtx.moveTo(0, h);
    cockpitCtx.lineTo(0, h * 0.74);
    cockpitCtx.quadraticCurveTo(w * 0.5, h * 0.62, w, h * 0.74);
    cockpitCtx.lineTo(w, h);
    cockpitCtx.closePath();
    cockpitCtx.fill();
    cockpitCtx.strokeStyle = "#39424f";
    cockpitCtx.lineWidth = 6;
    cockpitCtx.stroke();
    // Canopy pillars.
    cockpitCtx.strokeStyle = "#14181f";
    cockpitCtx.lineWidth = 26;
    cockpitCtx.beginPath();
    cockpitCtx.moveTo(w * 0.06, h * 0.78); cockpitCtx.lineTo(w * 0.2, 0);
    cockpitCtx.moveTo(w * 0.94, h * 0.78); cockpitCtx.lineTo(w * 0.8, 0);
    cockpitCtx.moveTo(w * 0.5, h * 0.66); cockpitCtx.lineTo(w * 0.5, 0);
    cockpitCtx.stroke();

    const gauge = (cx, cy, r, frac, label, value, color) => {
      cockpitCtx.fillStyle = "#0d1117";
      cockpitCtx.beginPath(); cockpitCtx.arc(cx, cy, r, 0, Math.PI * 2); cockpitCtx.fill();
      cockpitCtx.strokeStyle = "#5a6a7d"; cockpitCtx.lineWidth = 3;
      cockpitCtx.beginPath(); cockpitCtx.arc(cx, cy, r, 0, Math.PI * 2); cockpitCtx.stroke();
      const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
      cockpitCtx.strokeStyle = color; cockpitCtx.lineWidth = 6;
      cockpitCtx.beginPath(); cockpitCtx.arc(cx, cy, r - 7, a0, a0 + (a1 - a0) * THREE.MathUtils.clamp(frac, 0, 1)); cockpitCtx.stroke();
      const na = a0 + (a1 - a0) * THREE.MathUtils.clamp(frac, 0, 1);
      cockpitCtx.strokeStyle = "#ffd75e"; cockpitCtx.lineWidth = 4;
      cockpitCtx.beginPath();
      cockpitCtx.moveTo(cx, cy);
      cockpitCtx.lineTo(cx + Math.cos(na) * (r - 12), cy + Math.sin(na) * (r - 12));
      cockpitCtx.stroke();
      cockpitCtx.fillStyle = "#ffffff";
      cockpitCtx.font = "bold 17px sans-serif"; cockpitCtx.textAlign = "center";
      cockpitCtx.fillText(value, cx, cy + r * 0.62);
      cockpitCtx.font = "11px sans-serif"; cockpitCtx.fillStyle = "#9fd8ff";
      cockpitCtx.fillText(label, cx, cy + r + 16);
    };

    const gy = h * 0.86, gr = 52;
    gauge(w * 0.3, gy, gr, flight.speed / 95, "AIRSPEED KT", String(Math.round(flight.speed * 1.94)), "#57e6a9");
    gauge(w * 0.5, gy, gr, flight.position.y / 600, "ALTITUDE FT", String(Math.round(flight.position.y * 3.28)), "#57b6e6");
    gauge(w * 0.7, gy, gr, flight.throttle, "THROTTLE %", String(Math.round(flight.throttle * 100)), "#ffb340");
    // Fuel strip light.
    cockpitCtx.fillStyle = fuel > 25 ? "#2fbf71" : "#ff5a4e";
    cockpitCtx.fillRect(w * 0.44, h * 0.955, w * 0.12 * (fuel / 100), 12);
    cockpitCtx.strokeStyle = "#5a6a7d"; cockpitCtx.lineWidth = 2;
    cockpitCtx.strokeRect(w * 0.44, h * 0.955, w * 0.12, 12);
    cockpitCtx.fillStyle = "#ffffff"; cockpitCtx.font = "bold 13px sans-serif"; cockpitCtx.textAlign = "center";
    cockpitCtx.fillText("FUEL " + Math.round(fuel) + "%", w * 0.5, h * 0.99);
  }

  return {
    show() { el("hud").classList.remove("hidden"); },
    hide() { el("hud").classList.add("hidden"); },
    setCockpitVisible(v) { cockpitCanvas.classList.toggle("hidden", !v); },
    flashMessage(text, seconds = 2.2) {
      centerMsg.textContent = text;
      msgTimer = seconds;
    },
    update(flight, mission, cameraMode, dt) {
      altVal.textContent = String(Math.round(flight.position.y * 3.28));
      spdVal.textContent = String(Math.round(flight.speed * 1.94));
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
      viewVal.textContent = cameraMode === "cockpit" ? "COCKPIT" : "CHASE CAM";
      drawCompass(hdg);
      drawHorizon(flight.pitch, flight.roll);
      if (cameraMode === "cockpit") drawCockpitFrame(flight, mission.fuel);
      if (msgTimer > 0) {
        msgTimer -= dt;
        if (msgTimer <= 0) centerMsg.textContent = "";
      }
    }
  };
}
