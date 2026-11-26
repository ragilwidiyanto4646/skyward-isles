// main.ts — SKYWARD ISLES entry program.
// Copies game/ and screenshots/ (from beside this file) into the output
// directory and writes dossier.json there with the vendored makefun builder.
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-game.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

mkdirSync(outDir, { recursive: true });
cpSync(join(here, "game"), join(outDir, "game"), { recursive: true });
cpSync(join(here, "screenshots"), join(outDir, "screenshots"), { recursive: true });

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000
});
writeFileSync(join(outDir, "dossier.json"), dossier);
console.log("SKYWARD ISLES dossier written to " + join(outDir, "dossier.json"));
