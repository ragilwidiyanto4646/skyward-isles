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

  // ---- Cockpit panel -------------------------------------------------------
  // Glass cockpit layout: standby round six-pack on the far left, PFD and ND
  // color displays in the middle, an engine page with bar gauges, and the
  // radio stack on the far right. Static art (panel body, glare shield,
  // gauge faces, display bezels, switches, breakers, overhead strip) is
  // rendered once into an offscreen canvas; each frame we blit it and draw
  // only the moving parts: needles, attitude balls, tapes, the ND rose,
  // bar fills, readouts, annunciator lights, yoke and throttle levers.
  let cockpitStatic = null;

  const PANEL_TOP = 448;          // y of the panel face (canvas is 1280x720)
  const GAUGE_A0 = Math.PI * 0.75; // needle sweep: 135deg -> 405deg (270deg)
  const GAUGE_A1 = Math.PI * 2.25;

  // Standby six-pack layout: [cx, cy, r]
  const ASI_POS = [88, 498, 38];
  const ATT_POS = [178, 498, 38];
  const ALT_POS = [268, 498, 38];
  const TURN_POS = [88, 598, 38];
  const HDG_POS = [178, 598, 38];
  const VSI_POS = [268, 598, 38];

  // Glass display rectangles: [x, y, w, h]
  const PFD_RECT = [335, 460, 235, 190];
  const ND_RECT = [585, 460, 240, 190];
  const ENG_RECT = [840, 460, 145, 190];

  // Annunciator lamps: [cx, label]
  const ANNUN_Y = 668;
  const ANNUNS = [
    [400, "LOW FUEL"], [480, "STALL"], [560, "GEAR"], [640, "OIL"], [720, "ALT"]
  ];
  // Radio stack boxes: [y, label]
  const RADIO_X = 1000, RADIO_W = 240, RADIO_H = 40;
  const RADIOS = [
    [460, "COM1"], [508, "COM2"], [556, "NAV1"], [604, "XPDR"]
  ];
  const SWITCHES = ["BAT", "ALT", "NAV LTS", "LAND LTS", "FUEL PUMP"];
  const BREAKER_LABELS = [
    "PITOT", "FLAP", "TRIM", "GPS", "XPDR", "RADIO",
    "LIGHT", "FUEL", "GEAR", "AUTO", "HEAT", "SPARE"
  ];

  function gaugeAngle(frac) {
    return GAUGE_A0 + (GAUGE_A1 - GAUGE_A0) * THREE.MathUtils.clamp(frac, 0, 1);
  }

  // Draws a round gauge bezel + glowing face + tick ring + numerals + label
  // onto ctx. ticks: [{frac, major, text}] ; arc: optional {from,to,color}
  function drawGaugeFace(ctx, cx, cy, r, label, ticks, arc) {
    // Bezel
    ctx.fillStyle = "#2b333f";
    ctx.beginPath(); ctx.arc(cx, cy, r + 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#6b7a8d"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, r + 5, 0, Math.PI * 2); ctx.stroke();
    // Face with a soft radial glow
    const grad = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
    grad.addColorStop(0, "#1d2735");
    grad.addColorStop(0.75, "#111927");
    grad.addColorStop(1, "#0a0f18");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    // Colored arc (e.g. green operating range)
    if (arc) {
      ctx.strokeStyle = arc.color; ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, r - 5, gaugeAngle(arc.from), gaugeAngle(arc.to));
      ctx.stroke();
    }
    // Ticks and numerals
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
        ctx.font = "bold 11px sans-serif";
        ctx.fillText(t.text, cx + Math.cos(a) * (r - 17), cy + Math.sin(a) * (r - 17));
      }
    }
    // Label in the clear arc at the bottom of the dial
    ctx.fillStyle = "#9fd8ff";
    ctx.font = "bold 10px sans-serif";
    ctx.fillText(label, cx, cy + r * 0.62);
    ctx.textBaseline = "alphabetic";
  }

  function drawNeedle(ctx, cx, cy, r, frac, color) {
    const a = gaugeAngle(frac);
    ctx.strokeStyle = color || "#ffd75e";
    ctx.lineWidth = 3.5; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * 7, cy - Math.sin(a) * 7);
    ctx.lineTo(cx + Math.cos(a) * (r - 11), cy + Math.sin(a) * (r - 11));
    ctx.stroke();
    ctx.fillStyle = "#d7e3f2";
    ctx.beginPath(); ctx.arc(cx, cy, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.lineCap = "butt";
  }

  function screwHead(ctx, x, y) {
    ctx.fillStyle = "#4a5666";
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#232b36"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 4, y + 2); ctx.lineTo(x + 4, y - 2); ctx.stroke();
  }

  // Dark display bezel + screen well, shared by PFD / ND / engine page.
  function drawDisplayBezel(ctx, rect, title) {
    const [x, y, w, h] = rect;
    ctx.fillStyle = "#0b0e13";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#4a5666"; ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = "#232b36"; ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
    ctx.fillStyle = "#7fa8cc"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(title, x + w / 2, y + 20);
  }

  function buildStaticPanel(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");

    // Canopy pillars (keep the windshield clear above the panel)
    ctx.strokeStyle = "#14181f"; ctx.lineWidth = 26; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(w * 0.06, h * 0.78); ctx.lineTo(w * 0.2, 0);
    ctx.moveTo(w * 0.94, h * 0.78); ctx.lineTo(w * 0.8, 0);
    ctx.moveTo(w * 0.5, PANEL_TOP - 30); ctx.lineTo(w * 0.5, 0);
    ctx.stroke();
    ctx.lineCap = "butt";

    // Overhead panel hint: shallow dark band across the very top with rows
    // of small switches and lights at low contrast (slightly out of focus).
    const ohGrad = ctx.createLinearGradient(0, 0, 0, 50);
    ohGrad.addColorStop(0, "#1a212c");
    ohGrad.addColorStop(1, "#10151d");
    ctx.fillStyle = ohGrad;
    ctx.fillRect(0, 0, w, 50);
    ctx.strokeStyle = "#2e3947"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 50); ctx.lineTo(w, 50); ctx.stroke();
    const ohLights = ["#5a4632", "#3d5a44", "#5a3a36", "#46536a"];
    for (let i = 0; i < 26; i++) {
      const ox = 40 + i * 47;
      // Row 1: small round indicator lights
      ctx.fillStyle = ohLights[i % ohLights.length];
      ctx.beginPath(); ctx.arc(ox, 16, 4.5, 0, Math.PI * 2); ctx.fill();
      // Row 2: small toggle switches
      ctx.fillStyle = "#232b36";
      ctx.fillRect(ox - 3, 28, 6, 13);
      ctx.strokeStyle = "#4a5666"; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(ox, 39);
      ctx.lineTo(ox + (i % 3 === 0 ? 2 : -1), 30);
      ctx.stroke();
    }
    ctx.fillStyle = "#3d4a5c"; ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("OVERHEAD", w / 2, 47);

    // Glare shield: padded lip along the top edge, top at ~58% of height
    const shieldTop = h * 0.58;
    ctx.fillStyle = "#10141b";
    ctx.beginPath();
    ctx.moveTo(0, PANEL_TOP + 6);
    ctx.lineTo(0, shieldTop + 14);
    ctx.quadraticCurveTo(w * 0.5, shieldTop - 8, w, shieldTop + 14);
    ctx.lineTo(w, PANEL_TOP + 6);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#2e3947"; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, shieldTop + 14);
    ctx.quadraticCurveTo(w * 0.5, shieldTop - 8, w, shieldTop + 14);
    ctx.stroke();

    // Panel body with vertical gradient shading
    const pgrad = ctx.createLinearGradient(0, PANEL_TOP, 0, h);
    pgrad.addColorStop(0, "#27313f");
    pgrad.addColorStop(0.35, "#1e2733");
    pgrad.addColorStop(1, "#141a23");
    ctx.fillStyle = pgrad;
    ctx.fillRect(0, PANEL_TOP, w, h - PANEL_TOP);
    ctx.strokeStyle = "#3d4a5c"; ctx.lineWidth = 3;
    ctx.strokeRect(1, PANEL_TOP, w - 2, h - PANEL_TOP - 1);

    // Section seams
    ctx.strokeStyle = "#0c1016"; ctx.lineWidth = 3;
    ctx.beginPath();
    for (const sx of [322, 572, 828, 992]) {
      ctx.moveTo(sx, PANEL_TOP + 6); ctx.lineTo(sx, h - 6);
    }
    ctx.stroke();
    ctx.strokeStyle = "#35424f"; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const sx of [325, 575, 831, 995]) {
      ctx.moveTo(sx, PANEL_TOP + 6); ctx.lineTo(sx, h - 6);
    }
    ctx.stroke();

    // Screw heads in panel corners and section corners
    screwHead(ctx, 18, PANEL_TOP + 18); screwHead(ctx, w - 18, PANEL_TOP + 18);
    screwHead(ctx, 18, h - 18); screwHead(ctx, w - 18, h - 18);
    screwHead(ctx, 340, PANEL_TOP + 18); screwHead(ctx, 1008, PANEL_TOP + 18);
    screwHead(ctx, 304, h - 18); screwHead(ctx, 810, h - 18);

    ctx.textAlign = "center";

    // --- Standby six-pack static faces (attitude + heading cards dynamic) ---
    const asiTicks = [];
    for (let kt = 0; kt <= 200; kt += 20) {
      const showNum = kt % 40 === 0 && kt > 0 && kt < 200;
      asiTicks.push({ frac: kt / 200, major: true, text: showNum ? String(kt) : "" });
    }
    drawGaugeFace(ctx, ASI_POS[0], ASI_POS[1], ASI_POS[2], "KT", asiTicks,
      { from: 60 / 200, to: 160 / 200, color: "#2fbf71" });

    // Attitude bezel only; the ball itself moves every frame
    ctx.fillStyle = "#2b333f";
    ctx.beginPath(); ctx.arc(ATT_POS[0], ATT_POS[1], ATT_POS[2] + 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#6b7a8d"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ATT_POS[0], ATT_POS[1], ATT_POS[2] + 5, 0, Math.PI * 2); ctx.stroke();

    const altTicks = [];
    for (let f = 0; f < 10; f++) altTicks.push({ frac: f / 10, major: true, text: String(f) });
    drawGaugeFace(ctx, ALT_POS[0], ALT_POS[1], ALT_POS[2], "", altTicks, null);

    drawGaugeFace(ctx, TURN_POS[0], TURN_POS[1], TURN_POS[2], "", [], null);
    ctx.fillStyle = "#ffffff"; ctx.font = "bold 11px sans-serif";
    ctx.fillText("L", TURN_POS[0] - 22, TURN_POS[1] - 20);
    ctx.fillText("R", TURN_POS[0] + 22, TURN_POS[1] - 20);
    ctx.strokeStyle = "#9fd8ff"; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(TURN_POS[0] - 20, TURN_POS[1] + 16);
    ctx.quadraticCurveTo(TURN_POS[0], TURN_POS[1] + 23, TURN_POS[0] + 20, TURN_POS[1] + 16);
    ctx.stroke();
    ctx.fillStyle = "#9fd8ff"; ctx.font = "bold 9px sans-serif";
    ctx.fillText("TURN", TURN_POS[0], TURN_POS[1] + 33);

    // Heading bezel only; the compass card rotates every frame
    ctx.fillStyle = "#2b333f";
    ctx.beginPath(); ctx.arc(HDG_POS[0], HDG_POS[1], HDG_POS[2] + 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#6b7a8d"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(HDG_POS[0], HDG_POS[1], HDG_POS[2] + 5, 0, Math.PI * 2); ctx.stroke();

    const vsiTicks = [];
    for (let v = -2000; v <= 2000; v += 500) {
      const showNum = v === -2000 || v === 0 || v === 2000;
      vsiTicks.push({
        frac: (v + 2000) / 4000, major: showNum,
        text: showNum ? (v === 0 ? "0" : "20") : ""
      });
    }
    drawGaugeFace(ctx, VSI_POS[0], VSI_POS[1], VSI_POS[2], "V/S", vsiTicks, null);

    // --- Glass display bezels + static ND route ---
    drawDisplayBezel(ctx, PFD_RECT, "PFD");
    drawDisplayBezel(ctx, ND_RECT, "ND  40 NM");
    drawDisplayBezel(ctx, ENG_RECT, "ENGINE");

    // ND range rings + magenta route with waypoints (rose rotates per frame)
    {
      const cx = ND_RECT[0] + ND_RECT[2] / 2, cy = ND_RECT[1] + ND_RECT[3] / 2 + 6;
      ctx.strokeStyle = "rgba(87,230,169,0.35)"; ctx.lineWidth = 1.5;
      for (const rr of [28, 54, 80]) {
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
      }
      const wpts = [[cx - 52, cy + 48], [cx - 8, cy - 6], [cx + 40, cy - 52], [cx + 68, cy - 20]];
      ctx.strokeStyle = "#e65fd1"; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(wpts[0][0], wpts[0][1]);
      for (let i = 1; i < wpts.length; i++) ctx.lineTo(wpts[i][0], wpts[i][1]);
      ctx.stroke();
      ctx.fillStyle = "#e65fd1"; ctx.font = "bold 10px sans-serif";
      wpts.forEach(([wx, wy], i) => {
        ctx.beginPath(); ctx.arc(wx, wy, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillText("WPT" + (i + 1), wx + 4, wy - 7);
      });
      // Ownship triangle at center
      ctx.fillStyle = "#ffd75e";
      ctx.beginPath();
      ctx.moveTo(cx, cy - 11); ctx.lineTo(cx - 8, cy + 8); ctx.lineTo(cx + 8, cy + 8);
      ctx.closePath(); ctx.fill();
    }

    // Engine page bar outlines + labels (fills + readouts are dynamic)
    {
      const [ex, ey] = ENG_RECT;
      const barLabels = ["N1", "EGT", "FF"];
      barLabels.forEach((label, i) => {
        const bx = ex + 18 + i * 38;
        ctx.fillStyle = "#9fd8ff"; ctx.font = "bold 11px sans-serif";
        ctx.fillText(label, bx + 11, ey + 38);
        ctx.fillStyle = "#111927";
        ctx.fillRect(bx, ey + 44, 22, 72);
        ctx.strokeStyle = "#4a5666"; ctx.lineWidth = 1.5;
        ctx.strokeRect(bx, ey + 44, 22, 72);
        // Tick marks beside each bar
        ctx.strokeStyle = "#5a6a7d"; ctx.lineWidth = 1;
        for (let t = 0; t <= 4; t++) {
          const ty = ey + 44 + t * 18;
          ctx.beginPath(); ctx.moveTo(bx + 23, ty); ctx.lineTo(bx + 27, ty); ctx.stroke();
        }
      });
    }

    // --- Annunciator lamp housings (lit state + label drawn per frame) ---
    for (const [lx] of ANNUNS) {
      ctx.fillStyle = "#0b0e13";
      ctx.fillRect(lx - 32, ANNUN_Y - 12, 64, 24);
      ctx.strokeStyle = "#4a5666"; ctx.lineWidth = 2;
      ctx.strokeRect(lx - 32, ANNUN_Y - 12, 64, 24);
    }

    // --- Radio stack boxes + knobs (frequency readouts are dynamic) ---
    for (const [ry, label] of RADIOS) {
      ctx.fillStyle = "#0d1117";
      ctx.fillRect(RADIO_X, ry, RADIO_W, RADIO_H);
      ctx.strokeStyle = "#4a5666"; ctx.lineWidth = 2;
      ctx.strokeRect(RADIO_X, ry, RADIO_W, RADIO_H);
      ctx.fillStyle = "#9fd8ff"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "left";
      ctx.fillText(label, RADIO_X + 9, ry + 26);
      ctx.textAlign = "center";
      for (const kx of [RADIO_X + RADIO_W - 46, RADIO_X + RADIO_W - 20]) {
        ctx.fillStyle = "#39424f";
        ctx.beginPath(); ctx.arc(kx, ry + RADIO_H / 2, 9, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#8fa3ba"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(kx, ry + RADIO_H / 2); ctx.lineTo(kx + 5, ry + RADIO_H / 2 - 6); ctx.stroke();
      }
    }

    // --- Circuit-breaker panel (grid of small round breakers) ---
    ctx.fillStyle = "#7fa8cc"; ctx.font = "bold 11px sans-serif";
    ctx.fillText("CIRCUIT BREAKERS", RADIO_X + RADIO_W / 2, 662);
    BREAKER_LABELS.forEach((label, i) => {
      const bx = RADIO_X + 26 + (i % 6) * 40;
      const by = 678 + Math.floor(i / 6) * 20;
      ctx.fillStyle = "#39424f";
      ctx.beginPath(); ctx.arc(bx, by, 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#8fa3ba"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(bx, by, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#cfe3f7"; ctx.font = "bold 7px sans-serif";
      ctx.fillText(label, bx, by + 12);
    });

    // --- Switch row (toggle levers drawn in the ON position) ---
    SWITCHES.forEach((label, i) => {
      const sx = 60 + i * 60, sy = 688;
      ctx.fillStyle = "#0b0e13";
      ctx.fillRect(sx - 6, sy - 10, 12, 20);
      ctx.strokeStyle = "#4a5666"; ctx.lineWidth = 1.5;
      ctx.strokeRect(sx - 6, sy - 10, 12, 20);
      ctx.strokeStyle = "#d7e3f2"; ctx.lineWidth = 3.5; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(sx, sy + 4); ctx.lineTo(sx, sy - 8); ctx.stroke();
      ctx.lineCap = "butt";
      ctx.fillStyle = "#cfe3f7"; ctx.font = "bold 8px sans-serif";
      ctx.fillText(label, sx, sy + 19);
    });

    // --- Throttle quadrant housing (levers are dynamic) ---
    ctx.fillStyle = "#10151d";
    ctx.fillRect(835, 662, 155, 52);
    ctx.strokeStyle = "#4a5666"; ctx.lineWidth = 2;
    ctx.strokeRect(835, 662, 155, 52);
    ctx.fillStyle = "#7fa8cc"; ctx.font = "bold 10px sans-serif";
    ctx.fillText("THR", 868, 676); ctx.fillText("PROP", 912, 676); ctx.fillText("MIX", 956, 676);
    ctx.strokeStyle = "#39424f"; ctx.lineWidth = 3;
    for (const lx of [868, 912, 956]) {
      ctx.beginPath(); ctx.moveTo(lx - 16, 696); ctx.lineTo(lx + 16, 696); ctx.stroke();
    }

    // --- Rudder pedal hints at the very bottom edge ---
    ctx.fillStyle = "#0b0e13";
    ctx.fillRect(540, h - 12, 52, 12);
    ctx.fillRect(688, h - 12, 52, 12);
    ctx.strokeStyle = "#4a5666"; ctx.lineWidth = 1.5;
    ctx.strokeRect(540, h - 12, 52, 12);
    ctx.strokeRect(688, h - 12, 52, 12);
    ctx.fillStyle = "#5a6a7d"; ctx.font = "bold 9px sans-serif";
    ctx.fillText("L", 566, h - 3); ctx.fillText("R", 714, h - 3);

    return c;
  }

  function drawCockpitFrame(flight, fuel) {
    const w = cockpitCanvas.width, h = cockpitCanvas.height;
    const ctx = cockpitCtx;
    if (!cockpitStatic) cockpitStatic = buildStaticPanel(w, h);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(cockpitStatic, 0, 0);

    const knots = flight.speed * 1.94;
    const feet = flight.position.y * 3.28;
    const fpm = flight.verticalSpeed * 196.85;
    const hdgDeg = ((THREE.MathUtils.radToDeg(flight.heading) % 360) + 360) % 360;

    // --- Standby attitude indicator: blue/brown ball moving with pitch/roll ---
    {
      const [cx, cy, r] = ATT_POS;
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
      ctx.translate(cx, cy);
      ctx.rotate(-flight.roll);
      const pitchPx = THREE.MathUtils.clamp(flight.pitch, -0.8, 0.8) * 48;
      ctx.translate(0, pitchPx);
      ctx.fillStyle = "#3d8fd1"; ctx.fillRect(-r * 1.6, -r * 1.6, r * 3.2, r * 1.6);
      ctx.fillStyle = "#8a5a33"; ctx.fillRect(-r * 1.6, 0, r * 3.2, r * 1.6);
      ctx.fillStyle = "#ffffff"; ctx.fillRect(-r * 1.6, -1.2, r * 3.2, 2.4);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      for (const off of [-20, -10, 10, 20]) {
        const len = Math.abs(off) === 10 ? 24 : 16;
        ctx.fillRect(-len / 2, off - 0.8, len, 1.6);
      }
      ctx.restore();
      ctx.strokeStyle = "#ffd75e"; ctx.lineWidth = 3; ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx - 26, cy); ctx.lineTo(cx - 7, cy);
      ctx.moveTo(cx + 7, cy); ctx.lineTo(cx + 26, cy);
      ctx.stroke(); ctx.lineCap = "butt";
      ctx.fillStyle = "#ffd75e";
      ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
    }

    // --- Standby heading indicator: rotating compass card ---
    {
      const [cx, cy, r] = HDG_POS;
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
      const grad = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
      grad.addColorStop(0, "#1d2735"); grad.addColorStop(1, "#0a0f18");
      ctx.fillStyle = grad; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.translate(cx, cy);
      ctx.rotate(-THREE.MathUtils.degToRad(hdgDeg));
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (let deg = 0; deg < 360; deg += 15) {
        const a = THREE.MathUtils.degToRad(deg) - Math.PI / 2;
        const major = deg % 45 === 0;
        ctx.strokeStyle = "#e8f2ff"; ctx.lineWidth = major ? 2.5 : 1.2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * (r - 3), Math.sin(a) * (r - 3));
        ctx.lineTo(Math.cos(a) * (r - (major ? 10 : 7)), Math.sin(a) * (r - (major ? 10 : 7)));
        ctx.stroke();
        if (deg % 90 === 0) {
          const names = { 0: "N", 90: "E", 180: "S", 270: "W" };
          ctx.fillStyle = deg === 0 ? "#ff5a4e" : "#ffffff";
          ctx.font = "bold 12px sans-serif";
          ctx.fillText(names[deg], Math.cos(a) * (r - 19), Math.sin(a) * (r - 19));
        }
      }
      ctx.restore();
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#ffd75e";
      ctx.beginPath();
      ctx.moveTo(cx - 5, cy - r + 1); ctx.lineTo(cx + 5, cy - r + 1); ctx.lineTo(cx, cy - r + 9);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#ffd75e"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx - 14, cy); ctx.lineTo(cx + 14, cy);
      ctx.moveTo(cx, cy - 9); ctx.lineTo(cx, cy + 7);
      ctx.stroke(); ctx.lineCap = "butt";
    }

    // --- Standby turn coordinator: mini plane banking with roll + ball ---
    {
      const [cx, cy] = TURN_POS;
      ctx.save();
      ctx.translate(cx, cy - 3);
      ctx.rotate(THREE.MathUtils.clamp(flight.roll, -1, 1) * 0.7);
      ctx.fillStyle = "#ffd75e";
      ctx.beginPath();
      ctx.moveTo(-24, 0); ctx.lineTo(24, 0); ctx.lineTo(18, 5); ctx.lineTo(-18, 5);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-3, -10); ctx.lineTo(3, -10); ctx.lineTo(2, 7); ctx.lineTo(-2, 7);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-8, 6); ctx.lineTo(8, 6); ctx.lineTo(6, 10); ctx.lineTo(-6, 10);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      const ballX = cx + THREE.MathUtils.clamp(-flight.roll, -1, 1) * 14;
      ctx.fillStyle = "#0b0e13";
      ctx.beginPath(); ctx.arc(ballX, cy + 19, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#8fa3ba"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(ballX, cy + 19, 5, 0, Math.PI * 2); ctx.stroke();
    }

    // --- Standby needles + readouts ---
    drawNeedle(ctx, ASI_POS[0], ASI_POS[1], ASI_POS[2], knots / 200);
    ctx.fillStyle = "#ffffff"; ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(String(Math.round(knots)), ASI_POS[0], ASI_POS[1] + ASI_POS[2] * 0.88);

    drawNeedle(ctx, ALT_POS[0], ALT_POS[1], ALT_POS[2], (feet % 1000) / 1000);
    ctx.fillStyle = "#0b0e13";
    ctx.fillRect(ALT_POS[0] - 22, ALT_POS[1] + 14, 44, 15);
    ctx.strokeStyle = "#4a5666"; ctx.lineWidth = 1.2;
    ctx.strokeRect(ALT_POS[0] - 22, ALT_POS[1] + 14, 44, 15);
    ctx.fillStyle = "#57e6a9"; ctx.font = "bold 11px monospace";
    ctx.fillText(String(Math.round(feet)), ALT_POS[0], ALT_POS[1] + 25);

    drawNeedle(ctx, VSI_POS[0], VSI_POS[1], VSI_POS[2],
      (THREE.MathUtils.clamp(fpm, -2000, 2000) + 2000) / 4000);

    // --- PFD: attitude ball + speed/altitude tapes + heading strip ---
    {
      const [px, py, pw, ph] = PFD_RECT;
      const sx = px + 7, sy = py + 24, sw = pw - 14, sh = ph - 31;
      const tapeW = 42;
      const ballX = sx + tapeW, ballW = sw - tapeW * 2;
      const ballY = sy, ballH = sh - 26;
      const bcx = ballX + ballW / 2, bcy = ballY + ballH / 2;

      // Attitude ball with pitch ladder
      ctx.save();
      ctx.beginPath(); ctx.rect(ballX, ballY, ballW, ballH); ctx.clip();
      ctx.translate(bcx, bcy);
      ctx.rotate(-flight.roll);
      const pitchPx = THREE.MathUtils.clamp(flight.pitch, -0.9, 0.9) * 95;
      ctx.translate(0, pitchPx);
      ctx.fillStyle = "#2f7fc4"; ctx.fillRect(-ballW, -ballH, ballW * 2, ballH);
      ctx.fillStyle = "#8a5a33"; ctx.fillRect(-ballW, 0, ballW * 2, ballH);
      ctx.fillStyle = "#ffffff"; ctx.fillRect(-ballW, -1.2, ballW * 2, 2.4);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center";
      for (const deg of [-20, -10, 10, 20]) {
        const off = -deg * 2.6;
        const len = Math.abs(deg) === 10 ? 44 : 30;
        ctx.fillRect(-len / 2, off - 0.8, len, 1.6);
        ctx.fillText(String(Math.abs(deg)), -len / 2 - 9, off + 3);
        ctx.fillText(String(Math.abs(deg)), len / 2 + 9, off + 3);
      }
      ctx.restore();
      // Fixed aircraft symbol
      ctx.strokeStyle = "#ffd75e"; ctx.lineWidth = 3.5; ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(bcx - 34, bcy); ctx.lineTo(bcx - 9, bcy);
      ctx.moveTo(bcx + 9, bcy); ctx.lineTo(bcx + 34, bcy);
      ctx.stroke(); ctx.lineCap = "butt";
      ctx.fillStyle = "#ffd75e";
      ctx.beginPath(); ctx.arc(bcx, bcy, 3.5, 0, Math.PI * 2); ctx.fill();

      // Speed tape (left): scrolling ticks, current value boxed
      ctx.save();
      ctx.beginPath(); ctx.rect(sx, ballY, tapeW, ballH); ctx.clip();
      ctx.fillStyle = "rgba(8,12,20,0.85)";
      ctx.fillRect(sx, ballY, tapeW, ballH);
      const pxPerKt = ballH / 90;
      ctx.fillStyle = "#ffffff"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "left";
      ctx.strokeStyle = "#9fd8ff"; ctx.lineWidth = 1.5;
      const ktStart = Math.floor((knots - 50) / 10) * 10;
      for (let kt = ktStart; kt <= knots + 50; kt += 10) {
        if (kt < 0) continue;
        const ty = bcy - (kt - knots) * pxPerKt;
        ctx.beginPath(); ctx.moveTo(sx + tapeW - 8, ty); ctx.lineTo(sx + tapeW - 2, ty); ctx.stroke();
        if (kt % 20 === 0) ctx.fillText(String(kt), sx + 3, ty + 4);
      }
      ctx.restore();
      ctx.fillStyle = "#0b0e13";
      ctx.fillRect(sx + 2, bcy - 11, tapeW - 4, 22);
      ctx.strokeStyle = "#57e6a9"; ctx.lineWidth = 2;
      ctx.strokeRect(sx + 2, bcy - 11, tapeW - 4, 22);
      ctx.fillStyle = "#57e6a9"; ctx.font = "bold 15px monospace"; ctx.textAlign = "center";
      ctx.fillText(String(Math.round(knots)), sx + tapeW / 2, bcy + 5);

      // Altitude tape (right)
      const ax = sx + sw - tapeW;
      ctx.save();
      ctx.beginPath(); ctx.rect(ax, ballY, tapeW, ballH); ctx.clip();
      ctx.fillStyle = "rgba(8,12,20,0.85)";
      ctx.fillRect(ax, ballY, tapeW, ballH);
      const pxPerFt = ballH / 900;
      ctx.fillStyle = "#ffffff"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "left";
      ctx.strokeStyle = "#9fd8ff"; ctx.lineWidth = 1.5;
      const ftStart = Math.floor((feet - 500) / 100) * 100;
      for (let ft = ftStart; ft <= feet + 500; ft += 100) {
        if (ft < 0) continue;
        const ty = bcy - (ft - feet) * pxPerFt;
        ctx.beginPath(); ctx.moveTo(ax + 2, ty); ctx.lineTo(ax + 8, ty); ctx.stroke();
        if (ft % 200 === 0) ctx.fillText(String(ft / 100), ax + 11, ty + 4);
      }
      ctx.restore();
      ctx.fillStyle = "#0b0e13";
      ctx.fillRect(ax + 2, bcy - 11, tapeW - 4, 22);
      ctx.strokeStyle = "#57e6a9"; ctx.lineWidth = 2;
      ctx.strokeRect(ax + 2, bcy - 11, tapeW - 4, 22);
      ctx.fillStyle = "#57e6a9"; ctx.font = "bold 13px monospace"; ctx.textAlign = "center";
      ctx.fillText(String(Math.round(feet)), ax + tapeW / 2, bcy + 5);

      // Heading strip (bottom)
      const hy = sy + sh - 24;
      ctx.save();
      ctx.beginPath(); ctx.rect(sx, hy, sw, 24); ctx.clip();
      ctx.fillStyle = "rgba(8,12,20,0.9)";
      ctx.fillRect(sx, hy, sw, 24);
      const pxPerDeg = sw / 90;
      ctx.fillStyle = "#ffffff"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
      ctx.strokeStyle = "#9fd8ff"; ctx.lineWidth = 1.5;
      const hStart = Math.floor((hdgDeg - 50) / 10) * 10;
      for (let hd = hStart; hd <= hdgDeg + 50; hd += 10) {
        const deg = ((hd % 360) + 360) % 360;
        const tx = sx + sw / 2 + (hd - hdgDeg) * pxPerDeg;
        ctx.beginPath(); ctx.moveTo(tx, hy + 15); ctx.lineTo(tx, hy + 22); ctx.stroke();
        if (deg % 90 === 0) {
          const names = { 0: "N", 90: "E", 180: "S", 270: "W" };
          ctx.fillStyle = deg === 0 ? "#ff5a4e" : "#ffffff";
          ctx.fillText(names[deg], tx, hy + 12);
          ctx.fillStyle = "#ffffff";
        } else if (deg % 30 === 0) {
          ctx.fillText(String(deg / 10), tx, hy + 12);
        }
      }
      ctx.restore();
      ctx.fillStyle = "#0b0e13";
      ctx.fillRect(sx + sw / 2 - 20, hy + 1, 40, 16);
      ctx.strokeStyle = "#57e6a9"; ctx.lineWidth = 1.5;
      ctx.strokeRect(sx + sw / 2 - 20, hy + 1, 40, 16);
      ctx.fillStyle = "#57e6a9"; ctx.font = "bold 12px monospace"; ctx.textAlign = "center";
      ctx.fillText(String(Math.round(hdgDeg)).padStart(3, "0"), sx + sw / 2, hy + 13);
    }

    // --- ND: rotating compass rose over the static route ---
    {
      const cx = ND_RECT[0] + ND_RECT[2] / 2, cy = ND_RECT[1] + ND_RECT[3] / 2 + 6;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-THREE.MathUtils.degToRad(hdgDeg));
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (let deg = 0; deg < 360; deg += 10) {
        const a = THREE.MathUtils.degToRad(deg) - Math.PI / 2;
        const major = deg % 30 === 0;
        ctx.strokeStyle = "#57e6a9"; ctx.lineWidth = major ? 2.5 : 1.2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 82, Math.sin(a) * 82);
        ctx.lineTo(Math.cos(a) * (major ? 90 : 86), Math.sin(a) * (major ? 90 : 86));
        ctx.stroke();
        if (major) {
          const names = { 0: "N", 90: "E", 180: "S", 270: "W" };
          ctx.fillStyle = deg === 0 ? "#ff5a4e" : "#57e6a9";
          ctx.font = "bold 12px sans-serif";
          ctx.fillText(names[deg] || String(deg / 10), Math.cos(a) * 71, Math.sin(a) * 71);
        }
      }
      ctx.restore();
      ctx.textBaseline = "alphabetic";
      // Lubber tick at top
      ctx.fillStyle = "#ffd75e";
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy - 94); ctx.lineTo(cx + 6, cy - 94); ctx.lineTo(cx, cy - 84);
      ctx.closePath(); ctx.fill();
    }

    // --- Engine page: bar fills + digital readouts ---
    {
      const [ex, ey] = ENG_RECT;
      const n1 = 22 + flight.throttle * 78;        // %
      const egt = 380 + flight.throttle * 420;     // deg C
      const ff = 4 + flight.throttle * 38;         // gal/h
      const bars = [n1 / 100, (egt - 300) / 600, ff / 45];
      const barText = [String(Math.round(n1)), String(Math.round(egt)), ff.toFixed(1)];
      bars.forEach((frac, i) => {
        const bx = ex + 18 + i * 38;
        const f = THREE.MathUtils.clamp(frac, 0, 1);
        const bh = 72 * f;
        ctx.fillStyle = f > 0.9 ? "#ffb340" : "#2fbf71";
        ctx.fillRect(bx + 2, ey + 44 + 72 - bh, 18, bh);
        ctx.fillStyle = "#57e6a9"; ctx.font = "bold 12px monospace"; ctx.textAlign = "center";
        ctx.fillText(barText[i], bx + 11, ey + 130);
      });
      const rpm = 650 + flight.throttle * 1950;
      const map = 10 + flight.throttle * 18;
      const oilT = 75 + flight.throttle * 45;
      const oilP = 40 + flight.throttle * 35;
      const rows = [
        "RPM " + Math.round(rpm),
        "MAP " + map.toFixed(1),
        "FUEL " + Math.round(fuel) + "%",
        "OIL T " + Math.round(oilT),
        "OIL P " + Math.round(oilP)
      ];
      ctx.fillStyle = "#cfe3f7"; ctx.font = "bold 10px monospace"; ctx.textAlign = "left";
      rows.forEach((row, i) => ctx.fillText(row, ex + 14, ey + 142 + i * 11));
      ctx.textAlign = "center";
    }

    // --- Annunciator lights (lit ones glow, unlit stay dim) ---
    const oilP = 40 + flight.throttle * 35;
    const litStates = [
      fuel < 25,                                        // LOW FUEL
      !flight.onGround && flight.speed < 26,            // STALL
      flight.onGround,                                  // GEAR
      oilP < 45,                                        // OIL
      flight.throttle < 0.05 && !flight.onGround        // ALT
    ];
    const litColors = ["#ff5a4e", "#ff5a4e", "#2fbf71", "#ffb340", "#ffb340"];
    ANNUNS.forEach(([lx, label], i) => {
      if (litStates[i]) {
        ctx.save();
        ctx.shadowColor = litColors[i]; ctx.shadowBlur = 14;
        ctx.fillStyle = litColors[i];
        ctx.fillRect(lx - 30, ANNUN_Y - 10, 60, 20);
        ctx.restore();
        ctx.fillStyle = "#10141b"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(label, lx, ANNUN_Y + 4);
      } else {
        ctx.fillStyle = "#232b36";
        ctx.fillRect(lx - 30, ANNUN_Y - 10, 60, 20);
        ctx.fillStyle = "#5a6a7d"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(label, lx, ANNUN_Y + 4);
      }
    });

    // --- Radio frequency readouts (green digital) ---
    const freqs = ["118.70", "121.50", "110.30", "1200"];
    RADIOS.forEach(([ry], i) => {
      ctx.fillStyle = "#57e6a9"; ctx.font = "bold 18px monospace"; ctx.textAlign = "left";
      ctx.fillText(freqs[i], RADIO_X + 56, ry + 27);
    });
    ctx.textAlign = "center";

    // --- Throttle quadrant levers ---
    const leverX = (baseX, frac, color) => {
      const x = baseX - 16 + frac * 32;
      ctx.strokeStyle = "#8fa3ba"; ctx.lineWidth = 4.5; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(x, 708); ctx.lineTo(x, 692); ctx.stroke();
      ctx.lineCap = "butt";
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, 688, 8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#0b0e13"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, 688, 8, 0, Math.PI * 2); ctx.stroke();
    };
    leverX(868, flight.throttle, "#15181d"); // throttle (black)
    leverX(912, 0.92, "#2f6fd1");            // prop (blue), fixed near-full
    leverX(956, 1.0, "#d13a2f");             // mixture (red), full rich

    // --- Yoke: rotates with roll, shifts with pitch ---
    {
      const yokeX = 640;
      const yokeY = 702 + THREE.MathUtils.clamp(flight.pitch, -0.6, 0.6) * 12;
      ctx.save();
      ctx.translate(yokeX, yokeY);
      ctx.rotate(THREE.MathUtils.clamp(flight.roll, -1.2, 1.2) * 0.85);
      ctx.fillStyle = "#232b36";
      ctx.fillRect(-9, 5, 18, 26);
      ctx.strokeStyle = "#15181d"; ctx.lineWidth = 12; ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-72, -20);
      ctx.quadraticCurveTo(-64, 7, -35, 5);
      ctx.lineTo(35, 5);
      ctx.quadraticCurveTo(64, 7, 72, -20);
      ctx.stroke();
      ctx.strokeStyle = "#39424f"; ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(-72, -22);
      ctx.quadraticCurveTo(-64, 3, -35, 2);
      ctx.lineTo(35, 2);
      ctx.quadraticCurveTo(64, 3, 72, -22);
      ctx.stroke();
      ctx.lineCap = "butt";
      ctx.fillStyle = "#2b333f";
      ctx.beginPath(); ctx.arc(0, 1, 15, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#6b7a8d"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 1, 15, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#d13a2f";
      ctx.beginPath(); ctx.arc(0, 1, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
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
      // The 2D cockpitFrame overlay is retired: cockpit view now renders the
      // real 3D cockpit from cockpit3d.js. drawCockpitFrame is kept above
      // for reference but no longer drawn.
      if (msgTimer > 0) {
        msgTimer -= dt;
        if (msgTimer <= 0) centerMsg.textContent = "";
      }
    }
  };
}
