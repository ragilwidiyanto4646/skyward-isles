// input.js — keyboard + mouse drag flight controls.
export function createInput() {
  const state = {
    throttleUp: false,
    throttleDown: false,
    pitchInput: 0,   // -1..1, positive = nose up
    rollInput: 0,    // -1..1, positive = bank right
    keys: new Set(),
    mousePitch: 0,
    mouseRoll: 0,
    dragging: false,
    viewTogglePressed: false,
    pausePressed: false,
    restartPressed: false,
    // Free-camera orbit: when orbitMode is on (set by main.js while the free
    // camera is active), mouse drags and wheel turns are reported as orbit
    // deltas instead of flight pitch/roll. poll() publishes one frame's
    // worth of deltas in orbitDX/orbitDY/orbitZoom, then clears them.
    orbitMode: false,
    orbitDX: 0,
    orbitDY: 0,
    orbitZoom: 0
  };

  let lastX = 0, lastY = 0;
  let pendingOrbitDX = 0, pendingOrbitDY = 0, pendingOrbitZoom = 0;

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    if (!e.repeat) {
      if (k === "c") state.viewTogglePressed = true;
      if (k === "p") state.pausePressed = true;
      if (k === "r") state.restartPressed = true;
    }
    state.keys.add(k);
  });
  window.addEventListener("keyup", (e) => state.keys.delete(e.key.toLowerCase()));
  window.addEventListener("blur", () => state.keys.clear());

  window.addEventListener("mousedown", (e) => {
    state.dragging = true;
    lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener("mouseup", () => { state.dragging = false; state.mousePitch = 0; state.mouseRoll = 0; });
  window.addEventListener("mousemove", (e) => {
    if (!state.dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (state.orbitMode) {
      pendingOrbitDX += dx;
      pendingOrbitDY += dy;
      return;
    }
    state.mouseRoll = clamp(state.mouseRoll + dx * 0.012, -1, 1);
    state.mousePitch = clamp(state.mousePitch - dy * 0.012, -1, 1);
  });
  window.addEventListener("wheel", (e) => {
    if (state.orbitMode) pendingOrbitZoom += Math.sign(e.deltaY);
  }, { passive: true });

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  state.poll = function () {
    const k = state.keys;
    state.throttleUp = k.has("w") || k.has("shift");
    state.throttleDown = k.has("s") || k.has("control");
    let pitch = 0, roll = 0;
    if (k.has("arrowup")) pitch += 1;
    if (k.has("arrowdown")) pitch -= 1;
    if (k.has("arrowleft")) roll -= 1;
    if (k.has("arrowright")) roll += 1;
    // Mouse drag adds on top of arrows; decays back toward center when idle.
    pitch += state.mousePitch;
    roll += state.mouseRoll;
    if (!state.dragging) {
      state.mousePitch *= 0.9;
      state.mouseRoll *= 0.9;
    }
    state.pitchInput = clamp(pitch, -1, 1);
    state.rollInput = clamp(roll, -1, 1);
    // Publish this frame's free-camera orbit deltas, then clear them.
    state.orbitDX = pendingOrbitDX;
    state.orbitDY = pendingOrbitDY;
    state.orbitZoom = pendingOrbitZoom;
    pendingOrbitDX = 0; pendingOrbitDY = 0; pendingOrbitZoom = 0;
  };

  state.consumeViewToggle = function () {
    const v = state.viewTogglePressed;
    state.viewTogglePressed = false;
    return v;
  };
  state.consumePause = function () {
    const v = state.pausePressed;
    state.pausePressed = false;
    return v;
  };
  state.consumeRestart = function () {
    const v = state.restartPressed;
    state.restartPressed = false;
    return v;
  };

  return state;
}
