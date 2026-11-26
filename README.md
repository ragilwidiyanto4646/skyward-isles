[![make.fun — Best Flight Game](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![SKYWARD ISLES rank on make.fun](https://make.fun/badge/best-flight-game-20261126-0057/ragilwidiyanto4646/skyward-isles/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![SKYWARD ISLES reward on make.fun](https://make.fun/badge/best-flight-game-20261126-0057/ragilwidiyanto4646/skyward-isles/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)

# SKYWARD ISLES

An original 3D flight game built with three.js. Pilot a bright little prop plane over a procedurally generated archipelago at golden hour — sandy beaches, green hills, grey peaks, a seaside town with lit windows, and two runways with edge lights. Chase a timed ring course across six islands, hop to the far strip under a gold beacon, or just explore. Fuel drains as you fly; a gentle touchdown on any runway refills the tank.

## How to play

Serve the `game/` folder statically and open it in desktop Chrome (see Tech notes). Pick a mission on the title screen, then fly:

- **W / S** — throttle up / down (Shift / Ctrl also work)
- **Mouse drag** or **Arrow keys** — pitch and roll; bank to turn
- **C** — toggle chase / cockpit view
- **P** — pause
- **R** — restart the mission

The HUD always shows altitude (ft), airspeed (knots), a heading compass strip, an artificial horizon, throttle %, a fuel gauge, the current mission objective, and your score. Fly too slowly and the plane stalls and sinks; hit terrain hard and you crash. Land gently on a runway to refuel.

## Missions

1. **Ring Run** — fly through a sequence of 10 glowing rings over the islands, against the clock. The next ring glows gold.
2. **Island Hop** — take off from Home Runway, follow the gold beacon to Far Island, and land on its strip.
3. **Free Flight** — explore the archipelago at your own pace; landings earn bonus points.

## Tech notes

- three.js r160 is vendored at `game/vendor/three.module.min.js` and loaded via an import map — no build step, no network needed at play time.
- To play locally: serve `game/` with any static file server, e.g. `python3 -m http.server -d game 4173`, then open `http://127.0.0.1:4173/`.
- The world is generated from a seeded value-noise heightfield; add `?seed=N` to the URL for a different archipelago layout of trees and town (island shapes are fixed so the ring course always works).
- Screenshot staging URLs: `?shot=chase|cockpit|runway|panorama&seed=1` render deterministic scenes and set `window.__shotReady`.
- Entry program: `node main.ts` copies `game/` and `screenshots/` to `MAKEFUN_OUTPUT_DIR` (default `/output`) and writes `dossier.json` using `vendor/makefun-game.ts`.

## Entry note

This repository is an entry for the make.fun bounty **best-flight-game-20261126-0057** (Best Flight Game). All game code, the aircraft model, and the world generation are original work written for this bounty; the only third-party code is three.js (MIT) vendored under `game/vendor/` and make.fun's `vendor/makefun-game.ts` dossier builder, copied unchanged.
