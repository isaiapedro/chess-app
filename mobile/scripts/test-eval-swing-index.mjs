/**
 * Smoke: eval swing index + checkpoint eval band contracts.
 * Run: node scripts/test-eval-swing-index.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "../src/engine/gameCoach");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const swingSrc = fs.readFileSync(path.join(root, "evalSwingIndex.ts"), "utf8");
const phaseSrc = fs.readFileSync(path.join(root, "phaseCheckpointTip.ts"), "utf8");
const summarySrc = fs.readFileSync(path.join(root, "gameSummary.ts"), "utf8");
const metricsSrc = fs.readFileSync(path.join(root, "coachGameMetrics.ts"), "utf8");
const reqSrc = fs.readFileSync(path.join(root, "coachNoteRequest.ts"), "utf8");

assert(swingSrc.includes("classifyCheckpointEvalBand"), "band classifier");
assert(swingSrc.includes("buildEvalSwingIndex"), "swing index builder");
assert(swingSrc.includes("formatEvalSwingSummary"), "summary prose");
assert(swingSrc.includes("checkpointEvalOverlay"), "checkpoint overlay");
assert(swingSrc.includes('WP_WINNING = 0.85'), "winning threshold");
assert(swingSrc.includes("create practical chances"), "losing plan");

assert(phaseSrc.includes("evalBand"), "checkpoint takes evalBand");
assert(phaseSrc.includes("checkpointEvalOverlay"), "overlay wired");
assert(phaseSrc.includes('planLabel'), "winning/losing plan label");

assert(summarySrc.includes("buildEvalSwingIndex"), "summary uses index");
assert(summarySrc.includes("formatEvalSwingSummary"), "summary formats swings");
assert(summarySrc.includes("evalBeforeCp"), "summary plies carry eval");

assert(metricsSrc.includes("evalStampAtPly1"), "structural stamp helper");
assert(metricsSrc.includes("checkpointEvalInputs"), "EG stamp");
assert(reqSrc.includes("evalStamp"), "live request eval stamp");

// Pure logic mirror of classify + framing
function classify(wp) {
  if (wp == null || !Number.isFinite(wp)) return "unknown";
  if (wp >= 0.85) return "winning";
  if (wp >= 0.62) return "better";
  if (wp <= 0.15) return "losing";
  if (wp <= 0.38) return "worse";
  return "equal";
}
assert(classify(0.92) === "winning", "win");
assert(classify(0.08) === "losing", "loss");
assert(classify(0.5) === "equal", "eq");

function dropPp(before, after) {
  return Math.round((before - after) * 10000) / 100;
}
assert(dropPp(0.8, 0.5) >= 20, "crash size");

function formatSummary(index) {
  const bits = [];
  if (index.largestCrash) {
    bits.push(`biggest drop around move ${index.largestCrash.moveNumber}`);
  }
  if (index.finalWp != null) bits.push(`final ~${Math.round(index.finalWp * 100)}% WP`);
  return bits.length ? `Eval swings: ${bits.join("; ")}` : "";
}
const prose = formatSummary({
  largestCrash: { moveNumber: 24, dropPp: 28, wpAfter: 0.22 },
  finalWp: 0.31,
});
assert(prose.includes("Eval swings:"), prose);
assert(prose.includes("move 24"), prose);

console.log("test-eval-swing-index: ok");
