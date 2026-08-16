/**
 * Smoke: moment tip polish contracts (no RN / esbuild).
 * Run: node scripts/test-moment-judgment-tip.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(
  path.join(__dirname, "../src/engine/gameCoach/momentJudgmentTip.ts"),
  "utf8"
);
const metricNotes = fs.readFileSync(
  path.join(__dirname, "../src/engine/gameCoach/metricNotes.ts"),
  "utf8"
);
const explain = fs.readFileSync(
  path.join(__dirname, "../src/engine/gameCoach/engineLineExplain.ts"),
  "utf8"
);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(src.includes("composeMomentJudgmentTip"), "export composer");
assert(src.includes("on the board:"), "metric before→after clause");
assert(src.includes("narrateEngineLine"), "engine line narration");
assert(src.includes("situationFrame"), "situation frame");
assert(src.includes("stripPackToClause"), "pack clause strip");
assert(metricNotes.includes("composeMomentJudgmentTip"), "wired into metricNotes");
assert(!metricNotes.includes("Critical swing (~"), "metricNotes dropped Critical swing template");
assert(!explain.includes("Why better:"), "explain dropped Why better label");
assert(!explain.includes("Also:"), "explain dropped Also label");

function stripNumericNoise(s) {
  return String(s || "")
    .replace(/\s*\([+\-]?\d+(?:\.\d+)?\)/g, "")
    .replace(/\b[~≈]?\d+\s*cp\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

const dirty =
  "Critical swing (~150 cp). Prefer Nh5. Why better: bishop saw less (-9).";
const clean = stripNumericNoise(dirty);
assert(!/\b150\s*cp\b/i.test(clean), clean);
assert(!/\(-9\)/.test(clean), clean);

console.log("test-moment-judgment-tip: ok");
