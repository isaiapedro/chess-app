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
assert(src.includes("assembleFromAspects"), "flexible aspect assemble");
assert(src.includes("resolveTipTone"), "tone from criticalness");
assert(src.includes("topMetricHumanClauses"), "human metric clauses");
assert(!src.includes("on the board:"), "no numeric on-the-board dumps");
assert(src.includes("narrateEngineLine"), "engine line narration");
assert(src.includes("situationFrame"), "situation frame");
assert(src.includes("factLeads"), "any tactical fact suppresses sit/plan lead");
assert(!src.includes("trapPure"), "sit suppress not trapped-only");
assert(src.includes("stripPackToClause"), "pack clause strip");
assert(src.includes("praiseIdeaFromLine"), "praise explains move idea");
assert(metricNotes.includes("composeMomentJudgmentTip"), "wired into metricNotes");
assert(metricNotes.includes("tipMeta = woven"), "strategic tips update tip prior");
assert(!metricNotes.includes("Critical swing (~"), "metricNotes dropped Critical swing template");
assert(!explain.includes("Why better:"), "explain dropped Why better label");
assert(!explain.includes("Also:"), "explain dropped Also label");

const aspectSrc = fs.readFileSync(
  path.join(__dirname, "../src/engine/gameCoach/tipAspectAssemble.ts"),
  "utf8"
);
assert(aspectSrc.includes('TipTone = "praise" | "critique" | "neutral"'), "tones");
assert(aspectSrc.includes("assembleFromAspects"), "aspect assembler export");
assert(aspectSrc.includes("polarity"), "good/bad/neutral polarities");
assert(aspectSrc.includes("toneVerdictLead"), "dynamic verdict first phrase");
assert(aspectSrc.includes("frameAsCorrectIdea"), "correct-answer framing");
assert(aspectSrc.includes('voice?: AspectVoice'), "played vs correct voice");
assert(!aspectSrc.includes("predicament"), "no predicament in live verdicts");
assert(!aspectSrc.includes('bits.join("; ")'), "no semicolon glue");
assert(aspectSrc.includes("Better is"), "book framing Better is");
assert(aspectSrc.includes("bookJoin"), "period-separated book join");
assert(src.includes("toneVerdictLead"), "moment tip uses verdict lead");
assert(src.includes('voice: "correct"'), "engine/pack marked correct not played");
assert(src.includes("huntIsPlayedContinuation"), "opp hunt is not engine alternative");
assert(!src.includes("takes your trapped"), "self-trap hunt not framed as correct idea");
assert(!src.includes("playedMetricDelta?.length\n      ? args.playedMetricDelta\n      : args.engineVsPlayedMetricDelta"), "no engine-gap fallback as played");

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

function frameAsCorrectIdea(raw) {
  let t = String(raw || "")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "")
    .trim()
    .replace(/^prefer\s+/i, "")
    .replace(/^better was\s+/i, "");
  const low = t.charAt(0).toLowerCase() + t.slice(1);
  if (/^(to\s+|open|attack|connect)/i.test(low)) {
    return `Better is to ${low.replace(/^to\s+/i, "")}`;
  }
  return `Better is ${low}`;
}
assert(
  frameAsCorrectIdea("pieces working together on open lines").startsWith(
    "Better is"
  ),
  "noun phrase → Better is"
);
assert(
  frameAsCorrectIdea("open lines and attack on the queenside").startsWith(
    "Better is to"
  ),
  "action → Better is to"
);

console.log("test-moment-judgment-tip: ok");
