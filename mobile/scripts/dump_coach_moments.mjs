/**
 * Dump coach-call moment inputs + generated tip text for one annotated game.
 *
 * Prefer annotate JSON (samples/metrics_all.json). Optional matching PGN for
 * notePick / noteRequest comment bits. Regenerates soft keys + pack tip via
 * buildCoachNoteRequest / softKeysForNoteRequest / pickMetricTip, with live
 * situations / tacticalFact / gamePlan (same path as analyzeGame tip loop).
 * Passes annotate JSON `engine[].lines` so MultiPV gap + motif re-detect.
 * Rebuilds MG centre stamp (prefer_center_strike / fluidity / exposure / wing).
 *
 * Usage:
 *   cd mobile && npx --yes tsx scripts/dump_coach_moments.mjs
 *   npx --yes tsx scripts/dump_coach_moments.mjs ../samples/metrics_all.json
 *   npx --yes tsx scripts/dump_coach_moments.mjs ../samples/metrics_all.json --json
 *   npx --yes tsx scripts/dump_coach_moments.mjs --pgn ../samples/metrics_all.pgn
 *   npx --yes tsx scripts/dump_coach_moments.mjs ../samples/metrics_all.json --comment-refs
 *   # --comment-refs: top pack choices + only coach-moment fields the tip references
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCoachNoteRequest,
  formatCoachNoteRequest,
} from "../src/engine/gameCoach/coachNoteRequest.ts";
import { softKeysForNoteRequest } from "../src/engine/gameCoach/metricNoteKeys.ts";
import { pickMetricTip } from "../src/engine/gameCoach/metricNotes.ts";
import {
  explainAttachMetricTip,
  formatWeightBreakdown,
  rankMetricNoteWeights,
  themesForPly,
} from "../src/engine/gameCoach/metricNoteWeights.ts";
import {
  explainEngineLineVsPlayed,
} from "../src/engine/gameCoach/engineLineExplain.ts";
import {
  enrichOpeningCoachMoments,
  buildOpeningPeerSignals,
} from "../src/engine/gameCoach/openingCoachInputs.ts";
import { buildMiddlegamePeerSignals } from "../src/engine/gameCoach/middlegameCoachInputs.ts";
import { mergeOpeningTipPrior } from "../src/engine/gameCoach/openingJudgmentTip.ts";
import { defaultBundledPeerContext } from "../src/engine/gameCoach/openingCoachPeers.ts";
import { resolveOpeningPackKey } from "../src/engine/gameCoach/structureDetect.ts";
import {
  advanceGamePlan,
  emptyGamePlanState,
  formatGamePlanShort,
  markPlanKeysTaught,
  mergeOpeningPlanKeys,
} from "../src/engine/gameCoach/gamePlanState.ts";
import {
  formatSituationRolesShort,
  formatSituationsShort,
  mergeStickySituations,
} from "../src/engine/gameCoach/situationProfiles.ts";
import {
  formatTacticalFactHead,
  formatTacticalFactShort,
  tacticalFactInputs,
} from "../src/engine/gameCoach/tacticalFact.ts";
import { rankLinesByStm } from "../src/engine/gameCoach/tacticSharpness.ts";
import { phaseForCoachMoment } from "../src/engine/gameCoach/phaseSplits.ts";
import {
  buildCommentRefs,
  formatCommentRefs,
} from "../src/engine/gameCoach/commentRefs.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const MOBILE = join(HERE, "..");
const CHESS_ROOT = join(MOBILE, "..");
const DEFAULT_JSON = join(CHESS_ROOT, "samples/metrics_all.json");
const DEFAULT_PGN = join(CHESS_ROOT, "samples/metrics_all.pgn");

function usage() {
  console.error(`Usage: dump_coach_moments.mjs [annotate.json] [--pgn path] [--json] [--comment-refs]
  --comment-refs  top pack choices + only coach-moment refs used by the tip
  Default annotate JSON: ${DEFAULT_JSON}`);
}

function parseArgs(argv) {
  const out = { jsonPath: null, pgnPath: null, asJson: false, commentRefs: false };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") out.asJson = true;
    else if (a === "--comment-refs") out.commentRefs = true;
    else if (a === "--pgn") {
      out.pgnPath = argv[++i];
    } else if (a === "-h" || a === "--help") {
      usage();
      process.exit(0);
    } else if (a.startsWith("-")) {
      console.error("Unknown flag", a);
      usage();
      process.exit(1);
    } else rest.push(a);
  }
  out.jsonPath = rest[0] || DEFAULT_JSON;
  return out;
}

function absPath(p) {
  if (!p) return null;
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

/** Drop legacy piece-count hanging_* ; alias short hanging_material_opp. */
function canonicalizeField(field) {
  if (field === "hanging_own" || field === "hanging_opp") return null;
  if (field === "hanging_material_opp") return "hanging_material_opponent";
  return field;
}

/**
 * Parse formatMetricDeltaShort / annotate engine_vs_played strings into deltas.
 * Skips legacy hanging_own / hanging_opp counts.
 */
function parseMetricDeltaShort(raw) {
  if (!raw || typeof raw !== "string") return [];
  const out = [];
  for (const part of raw.split(",")) {
    const bit = part.trim();
    if (!bit) continue;
    const m = bit.match(
      /^([a-z0-9_]+):(-?\d+(?:\.\d+)?|null|true|false)→(-?\d+(?:\.\d+)?|null|true|false)(?:\(([+-]?\d+(?:\.\d+)?)\))?$/i
    );
    if (!m) continue;
    const field = canonicalizeField(m[1]);
    if (!field) continue;
    const before = parseScalar(m[2]);
    const after = parseScalar(m[3]);
    const delta =
      m[4] != null
        ? Number(m[4])
        : typeof before === "number" && typeof after === "number"
          ? Math.round((after - before) * 1000) / 1000
          : null;
    out.push({ field, before, after, delta });
  }
  return out;
}

function parseScalar(s) {
  if (s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  const n = Number(s);
  return Number.isFinite(n) ? n : s;
}

function phaseForPly(ply, coach, structuralKind) {
  const bounds = coach?.phaseBounds || {};
  return phaseForCoachMoment({
    ply1: ply,
    pieceCount: 32,
    bounds: {
      middlegameStartPly0:
        bounds.middlegameStartPly0 ??
        bounds.middlegameStartPly ??
        bounds.middlegame_start_ply ??
        null,
      endgameStartPly0:
        bounds.endgameStartPly0 ??
        bounds.endgameStartPly ??
        bounds.endgame_start_ply ??
        null,
    },
    structuralKind,
  });
}

function markFromMoment(moment) {
  const s = moment?.severity;
  if (
    s === "blunder" ||
    s === "mistake" ||
    s === "missed" ||
    s === "brilliant" ||
    s === "important" ||
    s === "excellent" ||
    s === "best" ||
    s === "inaccuracy"
  ) {
    return s;
  }
  return null;
}

function loadPackEntries() {
  const packPath = join(MOBILE, "assets/coach/mobile_coach_pack.json");
  const pack = JSON.parse(readFileSync(packPath, "utf8"));
  const raw = Array.isArray(pack?.entries) ? pack.entries : [];
  return raw.filter((e) =>
    /^(structure|opening|endgame|imbalance|positional|piece|motif|attack|methodology)\./.test(
      e.keyId || ""
    )
  );
}

function engineLinesForMoment(data, moment) {
  const rows = data?.engine;
  if (!Array.isArray(rows) || !moment?.ply) return [];
  const byPly = rows.find((r) => r && r.ply === moment.ply);
  const row = byPly || rows[moment.ply - 1];
  const lines = Array.isArray(row?.lines) ? row.lines : [];
  const fen = moment.fen || row?.fen;
  return fen && lines.length ? rankLinesByStm(fen, lines) : lines;
}

function trapContinuationSans(historySans, ply1, maxPly = 6) {
  if (!Array.isArray(historySans) || !ply1) return [];
  return historySans.slice(ply1, ply1 + maxPly).filter(Boolean);
}

/** Pull per-ply annotate comment blobs that mention noteRequest / notePick. */
function indexPgnComments(pgnText) {
  const byPly = new Map();
  if (!pgnText) return byPly;
  let ply = 0;
  const re =
    /(?:(?:\d+)\.(?:\.\.)?\s*)?([NBRQK]?[a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQ])?[+#]?|O-O-O|O-O)\s*(?:\{([^}]*)\})?/g;
  let m;
  while ((m = re.exec(pgnText))) {
    ply += 1;
    const comment = (m[2] || "").trim();
    if (!comment) continue;
    if (
      /noteRequest=|notePick|moment=|softKeys|engineVsPlayed|why_better/.test(
        comment
      )
    ) {
      byPly.set(ply, comment);
    }
  }
  return byPly;
}

function extractAnnotateBits(comment) {
  if (!comment) return {};
  const notePick = comment.match(/notePick\s+([^\s{][^}]*)/);
  const noteRequest = comment.match(/noteRequest=([^\s]+(?:\s(?!mark=|phase=|best=|moment=|noteAttach|notePick|themes=|candidate=|deltaCp=|wpDrop=|missedAfter)[^\s]+)*)/);
  const noteAttach = comment.match(/noteAttach=([^\s]+)/);
  const themes = comment.match(/themes=([^\s]+)/);
  return {
    notePick: notePick?.[1]?.trim() || null,
    noteRequest: noteRequest?.[1]?.trim() || null,
    noteAttach: noteAttach?.[1] || null,
    themes: themes?.[1] || null,
  };
}

function sanitizeInputs(inputs) {
  if (!inputs || typeof inputs !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(inputs)) {
    if (k === "hanging_own" || k === "hanging_opp") continue;
    if (
      typeof v === "string" &&
      (k === "engine_line_metrics" ||
        k === "played_line_metrics" ||
        k === "engine_vs_played")
    ) {
      out[k] = scrubMetricDeltaString(v);
      continue;
    }
    out[k] = v;
  }
  return out;
}

/** Drop legacy hanging_own/opp tokens from annotate metric strings. */
function scrubMetricDeltaString(raw) {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => {
      const field = part.split(":")[0];
      return field !== "hanging_own" && field !== "hanging_opp";
    })
    .map((part) =>
      part.startsWith("hanging_material_opp:")
        ? part.replace("hanging_material_opp:", "hanging_material_opponent:")
        : part
    )
    .join(",");
}

function enrichRequestFromMomentInputs(req, moment) {
  if (!req || !moment?.inputs) return req;
  const inputs = sanitizeInputs(moment.inputs);
  const engineLineSans = String(inputs.engine_line || "")
    .split(/\s+/)
    .filter(Boolean);
  const playedLineSans = String(inputs.played_line || "")
    .split(/\s+/)
    .filter(Boolean);
  const engineLineMetricDelta = parseMetricDeltaShort(
    inputs.engine_line_metrics
  );
  const playedLineMetricDelta = parseMetricDeltaShort(
    inputs.played_line_metrics
  );
  const engineVsPlayedMetricDelta = parseMetricDeltaShort(
    inputs.engine_vs_played
  );
  return {
    ...req,
    inputs: { ...(req.inputs || {}), ...inputs },
    engineLineSans: req.engineLineSans.length
      ? req.engineLineSans
      : engineLineSans,
    playedLineSans: req.playedLineSans.length
      ? req.playedLineSans
      : playedLineSans,
    engineLineMetricDelta: req.engineLineMetricDelta.length
      ? req.engineLineMetricDelta
      : engineLineMetricDelta,
    playedLineMetricDelta: req.playedLineMetricDelta.length
      ? req.playedLineMetricDelta
      : playedLineMetricDelta,
    engineVsPlayedMetricDelta: req.engineVsPlayedMetricDelta.length
      ? req.engineVsPlayedMetricDelta
      : engineVsPlayedMetricDelta,
  };
}

function commentRefsForRow(row) {
  const tip = row.tip;
  if (!tip?.text) return null;
  return buildCommentRefs({
    tipText: tip.text,
    keyIds: tip.keyIds || (tip.keyId ? [tip.keyId] : []),
    tipMeta: tip.tipMeta || null,
    weightTop: row.weightTop || [],
    softKeysPool: tip.tipMeta?.softKeys || tip.keyIds || row.softKeys || [],
    inputs: row.inputs || {},
    situations: row.situations || null,
    tacticalFact: row.request?.tacticalFact || null,
    primaryField: row.primaryField || null,
    primarySoftKeys: row.primarySoftKeys || tip.tipMeta?.softKeys || null,
  });
}

function dumpMomentCommentRefs(row) {
  const { moment, tip, phase } = row;
  const lines = [];
  lines.push("═".repeat(72));
  lines.push(
    `MOMENT ply=${moment.ply} move=${moment.moveNumber ?? "?"} ` +
      `mark=${moment.severity ?? "—"} structuralKind=${moment.structuralKind ?? "—"} ` +
      `phase=${phase} dropCp=${moment.dropCp ?? 0}`
  );
  lines.push(
    `played: ${moment.playedSan || "—"}  best: ${moment.bestSan || "—"}`
  );
  if (!row.attachLive?.attach || !tip) {
    lines.push("generated comment: (none)");
    lines.push("");
    return lines.join("\n");
  }
  const ids =
    tip.keyIds?.length ? tip.keyIds.join(", ") : tip.keyId || "—";
  lines.push("─ generated comment ─");
  lines.push(
    `keyId: ${tip.keyId}  keyIds: [${ids}]  score=${tip.score ?? "—"}  noteId=${tip.noteId || "—"}`
  );
  lines.push(tip.text || "(empty)");
  const refs = commentRefsForRow(row);
  if (refs) lines.push(formatCommentRefs(refs));
  lines.push("");
  return lines.join("\n");
}

function dumpMoment(row) {
  const {
    moment,
    request,
    softKeys,
    tip,
    annotate,
    phase,
  } = row;
  const lines = [];
  lines.push("═".repeat(72));
  lines.push(
    `MOMENT ply=${moment.ply} move=${moment.moveNumber ?? "?"} ` +
      `mark=${moment.severity ?? "—"} structuralKind=${moment.structuralKind ?? "—"} ` +
      `source=${moment.source ?? "—"} dropCp=${moment.dropCp ?? 0}`
  );
  lines.push("─".repeat(72));
  lines.push(`phase: ${phase}`);
  lines.push(`fen: ${moment.fen || "—"}`);
  lines.push(
    `played: ${moment.playedSan || "—"}  best: ${moment.bestSan || "—"}`
  );
  if (request) {
    lines.push(`noteRequest.kind: ${request.kind}`);
    lines.push(`noteRequest (fmt): ${formatCoachNoteRequest(request)}`);
  } else {
    lines.push("noteRequest: (none — would not attach)");
  }

  if (row.situations?.length) {
    lines.push(
      `situations: ${formatSituationsShort(row.situations)}` +
        (row.situationRoles ? `  roles=${row.situationRoles}` : "")
    );
    for (const s of row.situations) {
      lines.push(
        `  ${s.id} conf=${s.confidence}` +
          (s.role ? ` role=${s.role}` : "") +
          ` softKeys=${(s.softKeys || []).slice(0, 4).join(",")}`
      );
    }
  } else {
    lines.push("situations: (none)");
  }

  if (row.tacticalFact?.kind) {
    lines.push(
      `tactical: ${formatTacticalFactShort(row.tacticalFact)}` +
        `  head="${formatTacticalFactHead(row.tacticalFact)}"`
    );
  } else {
    lines.push("tactical: (none)");
  }

  if (row.gamePlanShort) {
    lines.push(`game_plan: ${row.gamePlanShort}`);
  } else {
    lines.push("game_plan: (empty)");
  }

  lines.push("inputs:");
  const inputs = sanitizeInputs(moment.inputs || {});
  const keys = Object.keys(inputs);
  if (!keys.length) lines.push("  (empty)");
  else {
    const coachMeta = new Set([
      "engine_line",
      "played_line",
      "engine_line_metrics",
      "played_line_metrics",
      "engine_vs_played",
      "why_better",
      "metric_keys",
      "primary_metric_keys",
      "primary_field",
      "metric_signals",
      "situations",
      "situation_roles",
      "game_plan",
      "tactical_kind",
      "tactical_line",
      "tactical_piece",
      "tactical_mate_in",
      "tactical_taken_next",
      "tactical_head",
      "tactical_trap_square",
      "tactical_capture_ply_delay",
      "tactical_material_delta",
      "tactical_motif",
      "tactical_sharp",
      "tactical_pv_gap_wp",
      "tactical_forcing_ratio",
      "key_id",
      "key_ids",
    ]);
    const metricSnap = keys.filter(
      (k) =>
        !coachMeta.has(k) &&
        !k.startsWith("peer_") &&
        !k.startsWith("tactical_")
    );
    const peerKeys = keys.filter((k) => k.startsWith("peer_")).sort();
    const sitKeys = keys.filter(
      (k) =>
        k === "situations" ||
        k === "situation_roles" ||
        k === "game_plan" ||
        k.startsWith("tactical_")
    );
    if (sitKeys.length) {
      lines.push("  [situations / tactical / plan stamps]");
      for (const k of sitKeys.sort()) {
        lines.push(`  ${k}: ${inputs[k]}`);
      }
    }
    const isOpeningCheckpoint =
      moment.structuralKind === "opening_name" ||
      moment.structuralKind === "opening_aggregate";
    const isMgCheckpoint =
      moment.structuralKind === "middlegame_aggregate" ||
      moment.structuralKind === "decisive_pawn_break";
    const isEgCheckpoint = moment.structuralKind === "endgame_advantage";
    const strategicKeys = new Set([
      "mg_structure_type",
      "mg_structure",
      "active_wing_user",
      "active_wing_opp",
      "user_wing_activity",
      "pawn_break_class",
      "prefer_center_strike",
      "center_fluidity_index",
      "pawn_storm_tempo_delta",
      "king_center_file_exposure",
      "closed_center",
      "opposite_side_castling",
      "opp_king_in_centre",
      "opp_king_uncastled",
      "vector_king_threat",
      "vector_piece_scope",
      "vector_pawn_health",
      "vector_infiltration",
      "king_attack_urgency",
      "played_move_error",
      "played_impact",
      "engine_line_plan",
      "strategic_summary",
      "endgame_type",
      "theoretical",
      "theoretical_shape",
      "theoretical_keys",
      "conversion_state",
      "vector_king_mechanics",
      "vector_pawn_dynamics",
      "vector_simplification",
      "vector_rook_activity",
      "technical_rule",
    ]);
    const stratSnap = metricSnap.filter((k) => strategicKeys.has(k));
    const phaseSnap = metricSnap.filter((k) => !strategicKeys.has(k));
    const snapLabel = isOpeningCheckpoint
      ? "[opening metric snapshot]"
      : isMgCheckpoint || phase === "middlegame"
        ? "[middlegame metric snapshot]"
        : isEgCheckpoint || phase === "endgame"
          ? "[endgame metric snapshot]"
          : `[${phase || "phase"} metric snapshot]`;
    if (phaseSnap.length) {
      lines.push(`  ${snapLabel}`);
      for (const k of phaseSnap.sort()) {
        lines.push(`  ${k}: ${inputs[k]}`);
      }
    }
    if (stratSnap.length) {
      lines.push(
        phase === "endgame" || isEgCheckpoint
          ? "  [endgame strategic vectors]"
          : "  [middlegame strategic vectors]"
      );
      for (const k of stratSnap.sort()) {
        lines.push(`  ${k}: ${inputs[k]}`);
      }
    }
    const showPeers =
      isOpeningCheckpoint ||
      moment.structuralKind === "middlegame_aggregate" ||
      peerKeys.length > 0;
    if (showPeers) {
      if (peerKeys.length) {
        lines.push("  [peer comparison]");
        for (const k of peerKeys) {
          lines.push(`  ${k}: ${inputs[k]}`);
        }
        const judgments = isOpeningCheckpoint
          ? buildOpeningPeerSignals(inputs)
          : buildMiddlegamePeerSignals(inputs);
        if (judgments.length) {
          lines.push("  [peer judgments]");
          for (const s of judgments) {
            const d =
              s.peerDelta == null
                ? "snap"
                : `${s.peerDelta > 0 ? "+" : ""}${s.peerDelta}`;
            lines.push(
              `  ${s.metric}: Δ=${d} polarity=${s.polarity} judgment=${s.judgment} impact=${s.impact > 0 ? "+" : ""}${s.impact} → ${s.softKeys.join(",")}`
            );
          }
        } else if (!peerKeys.some((k) => k.startsWith("peer_delta_"))) {
          lines.push(
            "  [peer judgments]: (none — peers present but no significant gaps)"
          );
        }
      } else if (isOpeningCheckpoint || isMgCheckpoint) {
        lines.push(
          "  [peer comparison]: (none — no peer_* stamps; enrich needs rating×speed + baselines)"
        );
      }
    }
    const lineBits = keys.filter(
      (k) =>
        k.startsWith("engine_") ||
        k.startsWith("played_") ||
        k === "why_better" ||
        k === "metric_keys" ||
        k === "primary_metric_keys" ||
        k === "primary_field" ||
        k === "metric_signals"
    );
    if (lineBits.length) {
      lines.push("  [line compare]");
      for (const k of lineBits.sort()) {
        lines.push(`  ${k}: ${inputs[k]}`);
      }
    }
  }
  if (row.metricSignals?.length) {
    lines.push("metricSignals (signed):");
    for (const s of row.metricSignals) {
      const sign = s.delta > 0 ? "+" : "";
      lines.push(
        `  ${s.field}: ${sign}${s.delta} ${s.polarity}` +
          (s.softHint ? ` softHint=${s.softHint}` : "")
      );
    }
  }
  if (row.primaryWhyBetter) {
    lines.push(
      `primary: why_better=${row.primaryWhyBetter}` +
        (row.primaryField ? ` field=${row.primaryField}` : "") +
        (row.primarySoftKeys?.length
          ? ` softKeys=${row.primarySoftKeys.join(",")}`
          : "")
    );
  }
  lines.push(`softKeys: ${softKeys.length ? softKeys.join(", ") : "(none)"}`);
  if (row.weightTop?.length) {
    lines.push("weights (top):");
    for (const w of row.weightTop) {
      lines.push(`  ${formatWeightBreakdown(w)}`);
    }
  }
  if (row.attachLive) {
    lines.push(
      `attach(live): ${row.attachLive.attach ? "yes" : "no"}` +
        (row.attachLive.reasons.length
          ? `(${row.attachLive.reasons.join("|")})`
          : "(noRule)")
    );
  }
  if (annotate?.noteAttach) lines.push(`annotate.noteAttach: ${annotate.noteAttach}`);
  if (annotate?.notePick) lines.push(`annotate.notePick: ${annotate.notePick}`);
  if (row.attachLive?.attach && tip) {
    lines.push("─ generated comment ─");
    const ids =
      tip.keyIds?.length
        ? tip.keyIds.join(", ")
        : tip.keyId || "—";
    lines.push(
      `keyId: ${tip.keyId}  keyIds: [${ids}]  score=${tip.score ?? "—"}  noteId=${tip.noteId || "—"}`
    );
    if (row.inputs?.key_ids || row.inputs?.key_id) {
      lines.push(
        `inputs.key_id=${row.inputs.key_id ?? "—"}  inputs.key_ids=${row.inputs.key_ids ?? "—"}`
      );
    }
    lines.push(tip.text || "(empty)");
    const refs = commentRefsForRow(row);
    if (refs) lines.push(formatCommentRefs(refs));
  }
  lines.push("");
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const jsonPath = absPath(args.jsonPath);
  if (!existsSync(jsonPath)) {
    console.error(`Annotate JSON not found: ${jsonPath}`);
    console.error(
      "Run: node scripts/annotate_metrics_pgn.mjs [game.pgn]  (from chess root)"
    );
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(jsonPath, "utf8"));
  const coach = data.coach;
  if (!coach?.momentsByPly) {
    console.error("JSON missing coach.momentsByPly — not an annotate dump?");
    process.exit(1);
  }
  const userColor = data.userColor === "white" ? "white" : "black";

  let pgnPath = absPath(args.pgnPath);
  if (!pgnPath) {
    const sibling = jsonPath.replace(/\.json$/i, ".pgn");
    if (existsSync(sibling)) pgnPath = sibling;
    else if (existsSync(DEFAULT_PGN)) pgnPath = DEFAULT_PGN;
  }
  const pgnText =
    pgnPath && existsSync(pgnPath) ? readFileSync(pgnPath, "utf8") : "";
  const pgnComments = pgnText ? indexPgnComments(pgnText) : new Map();

  function pgnHeader(name) {
    const m = pgnText.match(new RegExp(`\\[${name} "([^"]*)"\\]`));
    return m ? m[1] : null;
  }
  const userEloRaw =
    userColor === "white" ? pgnHeader("WhiteElo") : pgnHeader("BlackElo");
  const userRating =
    data.userRating ??
    (userEloRaw && Number.isFinite(Number(userEloRaw))
      ? Number(userEloRaw)
      : null);
  const timeControl = data.timeControl || pgnHeader("TimeControl") || null;
  const speed = data.speed || null;

  const entries = loadPackEntries();
  const openingKeyId =
    data.openingKeyId ||
    resolveOpeningPackKey(data.eco || null, data.openingName || null);
  const openingRow = data.opening || null;
  if (openingRow && coach.momentsByPly) {
    enrichOpeningCoachMoments({
      momentsByPly: coach.momentsByPly,
      opening: openingRow,
      userColor,
      badAccuracyMoves: data.candidates?.opening?.length ?? null,
      peer: defaultBundledPeerContext({
        rating: userRating,
        speed,
        timeControl,
      }),
      openingName: data.openingName || openingRow.opening_name || null,
    });
  }
  const engineRows = Array.isArray(data.engine) ? data.engine : [];
  const cpByPly = new Map();
  for (const row of engineRows) {
    if (row && row.ply != null) cpByPly.set(Number(row.ply), row.cpWhite);
  }
  function engineCpAt(ply1) {
    if (ply1 == null) return null;
    if (cpByPly.has(Number(ply1))) return cpByPly.get(Number(ply1));
    const idx = Number(ply1) - 1;
    return engineRows[idx]?.cpWhite ?? null;
  }

  const moments = Object.values(coach.momentsByPly).sort(
    (a, b) => (a.ply || 0) - (b.ply || 0)
  );

  const historySans = Array.isArray(data.sans) ? data.sans.filter(Boolean) : [];
  const rows = [];
  let openingPriorTopics = null;
  let gamePlan = emptyGamePlanState(openingKeyId);
  let stickySituations = [];
  for (const moment of moments) {
    const phase = phaseForPly(moment.ply, coach, moment.structuralKind);
    const mark = markFromMoment(moment);
    const engineSans = String(moment.inputs?.engine_line || "")
      .split(/\s+/)
      .filter(Boolean);
    const playedSans = String(moment.inputs?.played_line || "")
      .split(/\s+/)
      .filter(Boolean);
    let request = buildCoachNoteRequest({
      ply: moment.ply,
      phase,
      mark,
      moment,
      deltaCp: moment.dropCp || 0,
      userColor,
      fenBefore: moment.fen || undefined,
      fenAfter: moment.inputs?.fen_after
        ? String(moment.inputs.fen_after)
        : undefined,
      evalBeforeCp: moment.evalBeforeCp ?? engineCpAt(moment.ply) ?? null,
      evalAfterCp: moment.evalAfterCp ?? engineCpAt(moment.ply + 1) ?? null,
      playedSan: moment.playedSan || null,
      bestPvSan: engineSans,
      playedLineSans: playedSans,
      playedContinuationSans: (() => {
        const trap = trapContinuationSans(historySans, moment.ply);
        if (trap.length) return trap;
        return playedSans.length > 1 ? playedSans.slice(1) : [];
      })(),
      lines: engineLinesForMoment(data, moment),
      structureThemes: coach.themesByPhase?.[phase] || [],
    });
    request = enrichRequestFromMomentInputs(request, moment);
    stickySituations = mergeStickySituations(
      stickySituations,
      request?.situations || []
    );
    if (request) {
      request = { ...request, situations: stickySituations };
    }

    gamePlan = advanceGamePlan(gamePlan, {
      situations: stickySituations,
      structureThemes: [
        ...new Set(
          (coach.themesByPhase?.[phase] || []).concat(
            stickySituations.map((s) => s.id)
          )
        ),
      ],
      phase,
    });

    const softKeys = softKeysForNoteRequest({
      structuralKind: request?.structuralKind || moment.structuralKind,
      inputs: sanitizeInputs(request?.inputs || moment.inputs),
      playedMetricDelta: request?.playedMetricDelta,
      playedLineMetricDelta: request?.playedLineMetricDelta,
      engineLineMetricDelta: request?.engineLineMetricDelta,
      engineVsPlayedMetricDelta: request?.engineVsPlayedMetricDelta,
      kind: request?.kind,
      openingKeyId,
      phase,
      phaseMetricKeys: [],
      situations: request?.situations,
      planKeys: gamePlan.stickyKeys,
      tacticalFact: request?.tacticalFact,
    });

    const themes = themesForPly({
      metrics: coach,
      phase,
      moment,
      deltaCp: moment.dropCp || 0,
      request,
    });

    const explained =
      request &&
      (request.engineVsPlayedMetricDelta?.length ||
        request.engineLineMetricDelta?.length)
        ? explainEngineLineVsPlayed({
            bestSan: moment.bestSan,
            engineLineSans: request.engineLineSans,
            playedLineSans: request.playedLineSans,
            engineVsPlayedMetricDelta: request.engineVsPlayedMetricDelta,
            engineLineMetricDelta: request.engineLineMetricDelta,
            playedLineMetricDelta: request.playedLineMetricDelta,
            phase,
            openingKeyId,
          })
        : null;

    const attachLive = explainAttachMetricTip({
      phase,
      moment,
      mark,
      deltaCp: moment.dropCp || 0,
      phaseThemes: coach.themesByPhase?.[phase] || [],
      request,
    });

    const weightTop =
      request && attachLive.attach
        ? rankMetricNoteWeights({
            phase,
            themes,
            mark,
            deltaCp: moment.dropCp || 0,
            moment,
            openingKeyId,
            eco: data.eco || null,
            opening: data.openingName || null,
            limit: 8,
            request,
            gamePlan,
          })
        : [];

    const tip =
      request && attachLive.attach
        ? pickMetricTip({
            entries,
            metrics: coach,
            phase,
            mark,
            deltaCp: moment.dropCp || 0,
            moment,
            openingKeyId,
            eco: data.eco || null,
            opening: data.openingName || null,
            themes,
            request,
            userColor,
            priorTopics: openingPriorTopics,
            gamePlan,
            onOpeningTipUsed: (meta) => {
              openingPriorTopics = mergeOpeningTipPrior(openingPriorTopics, meta);
              gamePlan = mergeOpeningPlanKeys(
                gamePlan,
                meta.softKeys,
                openingKeyId
              );
            },
          })
        : null;

    if (attachLive.attach && (tip?.keyIds?.length || tip?.keyId)) {
      gamePlan = markPlanKeysTaught(
        gamePlan,
        tip.keyIds?.length ? tip.keyIds : tip.keyId ? [tip.keyId] : []
      );
    }

    const annotate = extractAnnotateBits(pgnComments.get(moment.ply) || "");

    const stampedInputs = { ...sanitizeInputs(moment.inputs || {}) };
    if (request?.inputs?.situations != null) {
      stampedInputs.situations = request.inputs.situations;
    }
    if (request?.inputs?.situation_roles != null) {
      stampedInputs.situation_roles = request.inputs.situation_roles;
    }
    if (request?.tacticalFact?.kind) {
      Object.assign(stampedInputs, tacticalFactInputs(request.tacticalFact));
    }
    if (request?.inputs) {
      for (const k of [
        "prefer_center_strike",
        "center_fluidity_index",
        "pawn_storm_tempo_delta",
        "king_center_file_exposure",
        "closed_center",
        "opposite_side_castling",
        "opp_king_in_centre",
        "opp_king_uncastled",
        "active_wing_user",
        "active_wing_opp",
        "user_wing_activity",
        "pawn_break_class",
        "mg_structure_type",
        "engine_line_plan",
        "strategic_summary",
      ]) {
        if (request.inputs[k] != null && request.inputs[k] !== "") {
          stampedInputs[k] = request.inputs[k];
        }
      }
    }
    stampedInputs.game_plan = formatGamePlanShort(gamePlan) || null;
    if (tip?.keyId) {
      const ids =
        tip.keyIds?.length
          ? tip.keyIds.slice(0, 3)
          : [tip.keyId];
      stampedInputs.key_id = ids[0];
      stampedInputs.key_ids = ids.join(",");
    }

    rows.push({
      ply: moment.ply,
      mark: moment.severity,
      structuralKind: moment.structuralKind || null,
      phase,
      fen: moment.fen || null,
      playedSan: moment.playedSan || null,
      bestSan: moment.bestSan || null,
      dropCp: moment.dropCp ?? 0,
      inputs: stampedInputs,
      situations: request?.situations || [],
      situationRoles: formatSituationRolesShort(request?.situations) || null,
      tacticalFact: request?.tacticalFact?.kind
        ? {
            kind: request.tacticalFact.kind,
            pieceLabel: request.tacticalFact.pieceLabel,
            captureSan: request.tacticalFact.captureSan,
            mateIn: request.tacticalFact.mateIn,
            takenNext: request.tacticalFact.takenNext,
            trapSquare: request.tacticalFact.trapSquare ?? null,
            capturePlyDelay: request.tacticalFact.capturePlyDelay ?? null,
            finalMaterialDelta:
              request.tacticalFact.finalMaterialDelta ?? null,
            selfInflicted: Boolean(request.tacticalFact.selfInflicted),
            head: formatTacticalFactHead(request.tacticalFact),
          }
        : null,
      gamePlanShort: formatGamePlanShort(gamePlan) || null,
      gamePlanSticky: [...gamePlan.stickyKeys],
      weightTop: weightTop.map((w) => ({
        keyId: w.keyId,
        weight: w.weight,
        parts: w.parts,
        formatted: formatWeightBreakdown(w),
      })),
      noteRequest: request
        ? {
            kind: request.kind,
            structuralKind: request.structuralKind || null,
            playedMetricDelta: request.playedMetricDelta,
            playedLineMetricDelta: request.playedLineMetricDelta,
            engineLineMetricDelta: request.engineLineMetricDelta,
            engineVsPlayedMetricDelta: request.engineVsPlayedMetricDelta,
            engineLineSans: request.engineLineSans,
            playedLineSans: request.playedLineSans,
            situations: request.situations || [],
            tacticalFact: request.tacticalFact || null,
            formatted: formatCoachNoteRequest(request),
          }
        : null,
      softKeys,
      themes,
      metricSignals: explained?.metricSignals || [],
      primaryWhyBetter: explained?.reasons?.join("; ") || null,
      primaryField: explained?.primaryField || null,
      primarySoftKeys: explained?.primarySoftKeys || [],
      attachLive,
      generatedComment: tip
        ? {
            keyId: tip.keyId,
            keyIds: tip.keyIds || (tip.keyId ? [tip.keyId] : []),
            noteId: tip.noteId || null,
            score: tip.score ?? null,
            text: tip.text,
            tipMeta: tip.tipMeta || null,
          }
        : null,
      annotate,
      moment,
      request,
      tip,
    });
  }

  for (const row of rows) {
    row.commentRefs = commentRefsForRow(row);
  }

  if (args.asJson) {
    const momentPayload = (r) => {
      const base = {
        ply: r.ply,
        mark: r.mark,
        structuralKind: r.structuralKind,
        phase: r.phase,
        fen: r.fen,
        playedSan: r.playedSan,
        bestSan: r.bestSan,
        dropCp: r.dropCp,
        generatedComment: r.generatedComment,
        commentRefs: r.commentRefs,
        attachLive: r.attachLive,
      };
      if (args.commentRefs) {
        return {
          ...base,
          weightTop: r.weightTop,
          softKeys: r.softKeys,
        };
      }
      return {
        ...base,
        inputs: r.inputs,
        situations: r.situations,
        situationRoles: r.situationRoles,
        tacticalFact: r.tacticalFact,
        gamePlanShort: r.gamePlanShort,
        gamePlanSticky: r.gamePlanSticky,
        weightTop: r.weightTop,
        noteRequest: r.noteRequest,
        softKeys: r.softKeys,
        themes: r.themes,
        metricSignals: r.metricSignals,
        primaryWhyBetter: r.primaryWhyBetter,
        primaryField: r.primaryField,
        primarySoftKeys: r.primarySoftKeys,
        annotate: r.annotate,
      };
    };
    console.log(
      JSON.stringify(
        {
          source: data.source || jsonPath,
          userColor,
          eco: data.eco || null,
          openingName: data.openingName || null,
          openingKeyId: data.openingKeyId || null,
          themesByPhase: coach.themesByPhase || {},
          globalThemes: coach.globalThemes || [],
          momentCount: rows.length,
          commentRefsMode: Boolean(args.commentRefs),
          moments: rows.map(momentPayload),
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`source: ${data.source || jsonPath}`);
  console.log(
    `userColor=${userColor} eco=${data.eco || "—"} opening=${data.openingName || "—"} openingKeyId=${openingKeyId || "—"}`
  );
  console.log(`moments: ${rows.length}  pgnCommentsIndexed: ${pgnComments.size}`);
  console.log(`globalThemes: ${(coach.globalThemes || []).join(", ") || "—"}`);
  console.log(
    `game_plan(final): ${formatGamePlanShort(gamePlan) || "—"}`
  );
  if (args.commentRefs) {
    console.log("mode: --comment-refs (top choices + tip-referenced coach fields only)");
  }
  console.log("");
  for (const row of rows) {
    process.stdout.write(
      args.commentRefs ? dumpMomentCommentRefs(row) : dumpMoment(row)
    );
  }
}

main();
