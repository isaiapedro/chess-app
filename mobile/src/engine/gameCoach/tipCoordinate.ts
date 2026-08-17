/**
 * Four-pillar localization matrix for coach comments.
 *
 * Occupied pillars weave into one sentence — not a winning weighted topic:
 * plan (opening/structure), principleLine (phase rule vs engine follow-up),
 * value (metric vector), feature (board-specific facts).
 */

import type { MetricFieldDelta } from "./coachNoteRequest";
import type { DetectedSituation } from "./situationProfiles";
import type { GamePlanState } from "./gamePlanState";
import { keysForMetricFields } from "./metricNoteKeys";
import {
  rankMetricAxes,
  significantRankedAxes,
  wideRankedAxes,
} from "./metricAxisRank";
import { clauseForSoftKey, METRIC_FIELD_SOFT_KEY } from "./metricClauseTemplates";
import { bookJoin } from "./coachProse";
import type { PackPickContext } from "./packNoteContent";

export type TipAxisKind =
  | "tempo"
  | "metric"
  | "situation"
  | "plan"
  | "tactical"
  | "opening"
  | "location";

export type TipAxisPolarity = "good" | "bad" | "neutral";

export type TipAxis = {
  kind: TipAxisKind;
  id: string;
  polarity: TipAxisPolarity;
  score: number;
  softKeys: string[];
  phrase: string | null;
  metric?: string;
};

export type TipLocation = {
  situationId: string | null;
  situationRole: string | null;
  tempoPiece: string | null;
  undevelopedMinors: boolean;
  oppKingInCentre: boolean;
  oppKingUncastled: boolean;
  ownUncastled: boolean;
};

export type LocationFactorId =
  | "dragon_cramped"
  | "dragon"
  | "maroczy_cramped"
  | "maroczy_binder"
  | "hedgehog_cramped"
  | "scheveningen"
  | "closed_center"
  | "queen_re_move"
  | "knight_re_move"
  | "tempo_waste"
  | "undeveloped_minors"
  | "opp_king_centre"
  | "opp_king_uncastled"
  | "own_uncastled";

export type TipPillars = {
  plan: string | null;
  principleLine: string | null;
  value: string | null;
  feature: string | null;
};

export type TipCoordinate = {
  phase: string;
  polarity: TipAxisPolarity;
  axes: TipAxis[];
  primaryField: string | null;
  primarySoftKeys: string[];
  liveMetrics: string[];
  liveSituations: string[];
  features: string[];
  location: TipLocation;
  factors: LocationFactorId[];
  pillars: TipPillars;
  bestSan: string | null;
  playedSan: string | null;
  scan: PillarConditionScan;
};

export type PillarConditionScan = {
  plan: string[];
  principleLine: string[];
  value: string[];
  feature: string[];
  ctx: PackPickContext;
};

export type LocalizedTip = {
  clause: string | null;
  clauses: string[];
  metrics: string[];
  softKeys: string[];
  topics: string[];
  factors: LocationFactorId[];
  includesContext: boolean;
  pillars: TipPillars;
};

const SIT_PLAN: Record<string, Partial<Record<string, string>>> = {
  dragon_formation: {
    cramped: "the cramped Dragon plan is queenside development",
    _: "the Dragon plan is a kingside attack once the structure is set",
  },
  maroczy_bind: {
    cramped: "the cramped side's plan is a pawn break to free the position",
    binder: "the Maróczy plan is to keep the bind and restrain freeing breaks",
    _: "the Maróczy plan is to restrain the d5 break",
  },
  hedgehog: {
    cramped: "the cramped Hedgehog plan is a timely pawn break",
    _: "the Hedgehog plan is to wait for a clean break",
  },
  scheveningen: {
    cramped: "the cramped Scheveningen plan is queenside counterplay",
    _: "the Scheveningen plan is a flexible central break",
  },
  closed_center: { _: "the closed-centre plan is to play on the wing the chain points to" },
  opposite_side_castling: { _: "the opposite-side plan is to race the pawn storm" },
  pawn_storm: { _: "the live plan is a pawn-storm race" },
  iqp: {
    iqp_owner: "the isolani plan is activity before a dry ending",
    blockader: "the plan vs the isolani is to blockade and trade",
    _: "the IQP plan is activity versus blockade",
  },
  minority_attack: {
    minority_attacker: "the minority-attack plan is b4–b5 to weaken a c-pawn",
    minority_defender: "the plan is to meet the minority attack without creating a weak c-pawn",
    _: "the Carlsbad plan is a minority attack",
  },
};

const OPENING_PLAN: Record<string, string> = {
  "opening.sicilian": "the Sicilian plan is c-file pressure and a timely central break",
  "opening.najdorf": "the Najdorf plan is queenside expansion with ...b5",
  "opening.dragon": "the Dragon plan is a kingside attack once the structure is set",
  "opening.french": "the French plan is to challenge the centre and free the light-squared bishop",
  "opening.caro_kann": "the Caro-Kann plan is solid development and a timely ...c5",
  "opening.kings_indian": "the King's Indian plan is a wing strike after the centre locks",
  "opening.queens_gambit": "the Queen's Gambit plan is to fight for d5 and the right freeing break",
  "opening.ruy_lopez": "the Ruy Lopez plan is to pressure e5 and prepare c3–d4",
  "opening.italian": "the Italian plan is to fight for d4/d5 and the long diagonals",
  "opening.english": "the English plan is to clamp d5 and expand with b4 or e3–d4",
  "opening.benko":
    "the Benko plan is queenside pressure on the a- and b-files and hanging-pawn tension",
  "opening.benoni":
    "the Benoni plan is queenside counterplay and a timely central break",
};

const VALUE_LABEL: Record<string, string> = {
  tempo_waste_rate_pct: "tempo",
  mobility: "activity",
  piece_support: "piece cover",
  king_attackers_pct: "king safety",
  opp_king_attackers_pct: "pressure on their king",
  space_advantage_pct: "space",
  hanging_material_own: "hanging material",
  hanging_material_opponent: "their hanging material",
  material_balance: "material",
  minors_developed: "development",
  center_control_pct: "the centre",
  queen_centralization: "queen centralization",
  connected_rooks: "rook connection",
  open_file_utilization: "open-file use",
  seventh_rank_infiltration: "the seventh rank",
  queenside_advance: "queenside space",
  kingside_advance: "kingside space",
  center_advance: "central space",
  pawn_storm_tempo: "the pawn-storm race",
  center_fluidity_index: "the open centre",
  king_center_file_exposure: "central king exposure",
  knight_vs_bishop: "knight vs bishop",
  good_vs_bad_bishop: "bishop quality",
  piece_liberation: "freeing the pieces",
  key_square_control: "key squares",
  attack_setup: "the attacking setup",
  second_weakness: "a second weakness",
};

const VALUE_ALLOW_OPENING = new Set([
  "tempo_waste_rate_pct",
  "mobility",
  "space_advantage_pct",
  "minors_developed",
  "center_control_pct",
  "hanging_material_own",
  "hanging_material_opponent",
  "material_balance",
  "king_attackers_pct",
  "opp_king_attackers_pct",
  "queenside_advance",
  "kingside_advance",
  "center_advance",
]);

const FEATURE_EXPAND: Record<string, string[]> = {
  opp_king_uncastled: [
    "uncastled-king",
    "unmoved-king",
    "uncastled_king",
    "unmoved_king",
  ],
  own_uncastled: [
    "uncastled-king",
    "unmoved-king",
    "uncastled_king",
    "unmoved_king",
  ],
  opp_king_centre: [
    "central-king",
    "king-in-centre",
    "king-in-center",
    "king_in_centre",
  ],
  undeveloped_minors: ["development-lead", "development_lead", "undeveloped_minors"],
  queen_re_move: ["tempo-gain", "tempo-waste", "tempo_waste", "queen_re_move"],
  knight_re_move: ["tempo-gain", "tempo-waste", "tempo_waste", "knight_re_move"],
  tempo_waste: ["tempo-gain", "tempo-waste", "tempo_waste"],
  closed_center: ["closed-center", "closed-centre", "closed_center"],
  dragon: ["dragon", "dragon_formation"],
  dragon_cramped: ["dragon", "dragon_formation", "cramped"],
  maroczy_cramped: ["maroczy", "maroczy_bind", "cramped"],
  maroczy_binder: ["maroczy", "maroczy_bind", "binder"],
  hedgehog_cramped: ["hedgehog", "cramped"],
  scheveningen: ["scheveningen"],
  mobility: ["active-pieces", "active_pieces"],
  open_file_utilization: ["open-file", "open_file"],
};

const PRINCIPLE_METRICS = new Set([
  "tempo_waste_rate_pct",
  "minors_developed",
  "center_control_pct",
  "uncastled_rate_pct",
]);

const FEATURE_CONSUMES: Partial<Record<LocationFactorId, string>> = {
  queen_re_move: "tempo_waste_rate_pct",
  knight_re_move: "tempo_waste_rate_pct",
  tempo_waste: "tempo_waste_rate_pct",
  undeveloped_minors: "minors_developed",
  opp_king_centre: "opp_king_in_centre",
  opp_king_uncastled: "opp_king_uncastled",
};

function truthyFlag(v: string | number | boolean | null | undefined): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

function numericFlag(
  v: string | number | boolean | null | undefined
): boolean {
  if (truthyFlag(v)) return true;
  if (typeof v === "number") return v >= 1;
  return false;
}

function deltaShowsFlag(
  deltas: MetricFieldDelta[] | null | undefined,
  field: string
): boolean {
  const d = (deltas || []).find((x) => x.field === field);
  if (!d) return false;
  return numericFlag(d.after) || numericFlag(d.before);
}

function cleanSan(s: string | null | undefined): string | null {
  const t = String(s || "").trim();
  if (!t || t === "—" || t === "-" || t === "null") return null;
  return t.replace(/[?!]+$/g, "");
}

function followUpLine(
  bestSan: string | null,
  engineLineSans: string[] | null | undefined
): string | null {
  return cleanSan(bestSan) || cleanSan(engineLineSans?.[0]);
}

export function engineVsPlayedClause(args: {
  playedSan?: string | null;
  bestSan?: string | null;
  engineLineSans?: string[] | null;
}): string | null {
  const played = cleanSan(args.playedSan);
  const best =
    cleanSan(args.bestSan) || cleanSan(args.engineLineSans?.[0]);
  const line = followUpLine(best, args.engineLineSans);
  if (!line) return null;
  const first = line.split(/\s+/)[0];
  if (played && first === played) return null;
  if (played) return `${line} instead of ${played}`;
  return line;
}

function sitPlan(id: string | null, role: string | null): string | null {
  if (!id) return null;
  const row = SIT_PLAN[id];
  if (!row) return null;
  if (role && row[role]) return row[role]!;
  return row._ || null;
}

export function openingIdentityPlan(
  key: string | null | undefined
): string | null {
  if (!key) return null;
  const k = key.toLowerCase();
  if (OPENING_PLAN[k]) return OPENING_PLAN[k]!;
  for (const [id, phrase] of Object.entries(OPENING_PLAN)) {
    if (k.includes(id.replace("opening.", ""))) return phrase;
  }
  return null;
}

function openingPlanFromKey(key: string | null | undefined): string | null {
  return openingIdentityPlan(key);
}

function wingPlan(
  inputs: Record<string, string | number | boolean | null> | null | undefined
): string | null {
  const wing = String(inputs?.active_wing_user || "").toLowerCase();
  if (wing === "queenside") return "the live plan is queenside";
  if (wing === "kingside") return "the live plan is kingside";
  if (wing === "center" || wing === "centre") return "the live plan is a central strike";
  return null;
}

export function detectLocationFactors(loc: TipLocation): LocationFactorId[] {
  const out: LocationFactorId[] = [];
  const sit = loc.situationId;
  const role = loc.situationRole;
  if (sit === "dragon_formation" && role === "cramped") out.push("dragon_cramped");
  else if (sit === "dragon_formation") out.push("dragon");
  if (sit === "maroczy_bind" && role === "cramped") out.push("maroczy_cramped");
  else if (sit === "maroczy_bind" && role === "binder") out.push("maroczy_binder");
  if (sit === "hedgehog" && role === "cramped") out.push("hedgehog_cramped");
  if (sit === "scheveningen") out.push("scheveningen");
  if (sit === "closed_center") out.push("closed_center");

  if (loc.tempoPiece === "q") out.push("queen_re_move");
  else if (loc.tempoPiece === "n") out.push("knight_re_move");
  else if (loc.tempoPiece) out.push("tempo_waste");

  if (loc.undevelopedMinors) out.push("undeveloped_minors");
  if (loc.oppKingInCentre) out.push("opp_king_centre");
  else if (loc.oppKingUncastled) out.push("opp_king_uncastled");
  if (loc.ownUncastled && !loc.oppKingInCentre && !loc.oppKingUncastled) {
    out.push("own_uncastled");
  }
  return out;
}

function axisKindForField(field: string): TipAxisKind {
  if (field === "tempo_waste_rate_pct") return "tempo";
  if (
    field === "opp_king_in_centre" ||
    field === "opp_king_uncastled" ||
    field === "minors_developed"
  ) {
    return "location";
  }
  return "metric";
}

function polarityFromHelps(
  helpsEngine: boolean,
  critique: boolean
): TipAxisPolarity {
  if (helpsEngine) return critique ? "bad" : "good";
  return critique ? "good" : "bad";
}

function phraseForAxis(
  field: string,
  polarity: TipAxisPolarity
): string | null {
  const judgment = polarity === "good" ? "good" : "bad";
  if (field === "tempo_waste_rate_pct") {
    return judgment === "bad"
      ? "avoiding tempo-wasting moves while developing"
      : "clean development without wasted tempi";
  }
  if (field === "piece_support") {
    return judgment === "bad"
      ? "pieces covering one another"
      : "pieces already covering one another";
  }
  const softKey = METRIC_FIELD_SOFT_KEY[field];
  if (!softKey) return null;
  return clauseForSoftKey(softKey, judgment);
}

function locationFromInputs(
  inputs: Record<string, string | number | boolean | null> | null | undefined,
  deltas: MetricFieldDelta[] | null | undefined,
  situations: DetectedSituation[] | null | undefined
): TipLocation {
  const rankedSits = [...(situations || [])].sort(
    (a, b) =>
      (b.lockBoost || 0) - (a.lockBoost || 0) ||
      (b.confidence || 0) - (a.confidence || 0)
  );
  const sit = rankedSits[0] || null;
  const minorsRaw = inputs?.minors_developed;
  const minorsN =
    typeof minorsRaw === "number"
      ? minorsRaw
      : typeof minorsRaw === "string" && minorsRaw !== ""
        ? Number(minorsRaw)
        : null;
  const piece = String(inputs?.played_tempo_piece || "").toLowerCase();
  const tempo =
    truthyFlag(inputs?.played_tempo_waste)
      ? piece === "queen"
        ? "q"
        : piece || "x"
      : null;
  return {
    situationId: sit?.id || null,
    situationRole: sit?.role || null,
    tempoPiece: tempo,
    undevelopedMinors:
      truthyFlag(inputs?.undeveloped_minors) ||
      (minorsN != null && Number.isFinite(minorsN) && minorsN < 4),
    oppKingInCentre:
      numericFlag(inputs?.opp_king_in_centre) ||
      deltaShowsFlag(deltas, "opp_king_in_centre"),
    oppKingUncastled:
      numericFlag(inputs?.opp_king_uncastled) ||
      deltaShowsFlag(deltas, "opp_king_uncastled"),
    ownUncastled:
      truthyFlag(inputs?.uncastled) ||
      numericFlag(inputs?.uncastled_rate_pct),
  };
}

function collectLocationFactors(
  loc: TipLocation,
  situations: DetectedSituation[] | null | undefined
): LocationFactorId[] {
  const board = detectLocationFactors({
    ...loc,
    situationId: null,
    situationRole: null,
  });
  if (!situations?.length) {
    return [...new Set([...board, ...detectLocationFactors(loc)])];
  }
  const sitBits: LocationFactorId[] = [];
  for (const s of situations) {
    sitBits.push(
      ...detectLocationFactors({
        ...loc,
        situationId: s.id,
        situationRole: s.role || null,
      })
    );
  }
  return [...new Set([...board, ...sitBits])];
}

function expandLiveToken(token: string): string[] {
  const out = [token, token.replace(/_/g, "-"), token.replace(/-/g, "_")];
  const extra = FEATURE_EXPAND[token] || FEATURE_EXPAND[token.replace(/-/g, "_")];
  if (extra) out.push(...extra);
  return out;
}

function uniqTokens(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const s = String(t || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export function scanPillarConditions(
  coord: Omit<TipCoordinate, "scan"> | TipCoordinate,
  extra?: {
    themes?: readonly string[] | null;
    judgment?: PackPickContext["judgment"];
    openings?: readonly string[] | null;
  }
): PillarConditionScan {
  const plan: string[] = [];
  const principleLine: string[] = [];
  const value: string[] = [];
  const feature: string[] = [];

  for (const sit of coord.liveSituations) {
    plan.push(sit, ...expandLiveToken(sit));
  }
  if (coord.location.situationRole) {
    plan.push(coord.location.situationRole);
  }
  for (const f of coord.factors) {
    if (
      f === "dragon_cramped" ||
      f === "dragon" ||
      f === "maroczy_cramped" ||
      f === "maroczy_binder" ||
      f === "hedgehog_cramped" ||
      f === "scheveningen" ||
      f === "closed_center"
    ) {
      plan.push(f, ...expandLiveToken(f));
    }
  }
  for (const k of coord.primarySoftKeys) {
    if (String(k).startsWith("opening.")) plan.push(k);
  }

  for (const f of coord.factors) {
    if (
      f === "queen_re_move" ||
      f === "knight_re_move" ||
      f === "tempo_waste" ||
      f === "undeveloped_minors"
    ) {
      principleLine.push(f, ...expandLiveToken(f));
    }
  }
  for (const field of coord.liveMetrics) {
    if (PRINCIPLE_METRICS.has(field)) principleLine.push(field);
  }
  if (coord.bestSan) principleLine.push("engine_follow_up");

  for (const field of coord.liveMetrics) {
    if (!PRINCIPLE_METRICS.has(field)) value.push(field);
    value.push(...expandLiveToken(field));
    const mapped = keysForMetricFields([field]);
    value.push(...mapped);
  }

  for (const f of coord.factors) {
    feature.push(f, ...expandLiveToken(f));
  }
  for (const f of coord.features) {
    feature.push(f, ...expandLiveToken(f));
  }

  const planU = uniqTokens(plan);
  const principleU = uniqTokens(principleLine);
  const valueU = uniqTokens(value);
  const featureU = uniqTokens(feature);
  const wide = uniqTokens([...planU, ...principleU, ...valueU, ...featureU]);

  const ctx: PackPickContext = {
    phase: coord.phase,
    softKeys: uniqTokens([
      ...coord.primarySoftKeys,
      ...coord.axes.flatMap((a) => a.softKeys),
      ...wide.filter((t) => t.includes(".")),
    ]),
    metrics: uniqTokens([
      ...coord.liveMetrics,
      ...wide.filter((t) => !t.includes(".") && !t.includes("-") && t.includes("_")),
    ]),
    situations: uniqTokens([
      ...coord.liveSituations,
      ...wide.filter((t) =>
        /dragon|maroczy|hedgehog|scheveningen|iqp|pawn_storm|closed_center|minority/i.test(
          t
        )
      ),
    ]),
    themes: [...(extra?.themes || [])],
    openings: [...(extra?.openings || [])],
    features: uniqTokens([...coord.features, ...featureU, ...wide]),
    judgment: extra?.judgment ?? (coord.polarity === "bad" ? "bad" : coord.polarity === "good" ? "good" : null),
  };

  return {
    plan: planU,
    principleLine: principleU,
    value: valueU,
    feature: featureU,
    ctx,
  };
}

function featuresFromLocation(
  loc: TipLocation,
  factors: LocationFactorId[]
): string[] {
  const out: string[] = [...factors];
  if (loc.tempoPiece === "q") out.push("queen_re_move", "tempo_waste");
  else if (loc.tempoPiece) out.push("tempo_waste", `${loc.tempoPiece}_re_move`);
  if (loc.undevelopedMinors) out.push("undeveloped_minors");
  if (loc.oppKingInCentre) out.push("opp_king_centre");
  if (loc.oppKingUncastled) out.push("opp_king_uncastled");
  return [...new Set(out)];
}

function buildPlanPillar(args: {
  location: TipLocation;
  factors: LocationFactorId[];
  phase: string;
  inputs: Record<string, string | number | boolean | null> | null | undefined;
  openingKeyId: string | null;
  gamePlan: GamePlanState | null | undefined;
}): string | null {
  const fromSit = sitPlan(args.location.situationId, args.location.situationRole);
  if (fromSit) return fromSit;
  const ownQ =
    typeof args.inputs?.queenside_advance === "number"
      ? args.inputs.queenside_advance
      : 0;
  const ownK =
    typeof args.inputs?.kingside_advance === "number"
      ? args.inputs.kingside_advance
      : 0;
  const openingWing =
    args.phase === "opening" && ownQ >= 4 && ownQ > ownK
      ? "the live plan is queenside"
      : args.phase === "opening" && ownK >= 4
        ? "the live plan is kingside"
        : null;
  const wing =
    openingWing || (args.phase === "opening" ? null : wingPlan(args.inputs));
  if (wing) return wing;
  const sticky = args.gamePlan?.stickyKeys?.[0] || args.openingKeyId;
  const fromOpening = openingPlanFromKey(sticky);
  if (fromOpening && args.phase === "opening") return fromOpening;
  if (fromOpening && !args.location.situationId) return fromOpening;
  return null;
}

function buildPrincipleLinePillar(args: {
  phase: string;
  critique: boolean;
  factors: LocationFactorId[];
  line: string | null;
  played: string | null;
  inputs: Record<string, string | number | boolean | null> | null | undefined;
}): string | null {
  const { phase, critique, factors, line, played } = args;
  const queen = factors.includes("queen_re_move");
  const knight = factors.includes("knight_re_move");
  const tempo = factors.includes("tempo_waste");
  const undeveloped = factors.includes("undeveloped_minors");
  const breakClass = String(args.inputs?.pawn_break_class || "");

  if (critique && queen) {
    return line
      ? played
        ? `${line} develops instead of ${played}`
        : `${line} develops instead of a second queen move`
      : "opening principles ask you to develop instead of a second queen move";
  }
  if (critique && knight) {
    return line
      ? played
        ? `${line} develops instead of ${played}`
        : `${line} develops instead of re-routing a knight`
      : "finish development instead of re-routing a knight";
  }
  if (critique && tempo) {
    return line
      ? played
        ? `${line} uses the tempo to develop instead of ${played}`
        : `${line} uses the tempo to develop`
      : "use the tempo to develop instead of moving a developed piece again";
  }
  if (critique && phase === "opening" && undeveloped && line) {
    return played
      ? `${line} finishes development instead of ${played}`
      : `${line} finishes development`;
  }
  if (critique && phase === "middlegame" && /wrong_/.test(breakClass) && line) {
    return played
      ? `${line} plays the recommended wing instead of ${played}`
      : `${line} plays the recommended wing instead of the played break`;
  }
  if (critique && line && played && line.split(/\s+/)[0] !== played) {
    return `${line} instead of ${played}`;
  }
  if (!critique && line && phase === "opening") {
    return `${line} keeps the opening principles`;
  }
  return null;
}

function buildFeaturePillar(factors: LocationFactorId[]): string | null {
  const bits: string[] = [];
  if (factors.includes("undeveloped_minors")) {
    bits.push("minors still sit undeveloped");
  }
  if (factors.includes("opp_king_centre")) {
    bits.push("their king is still in the centre");
  } else if (factors.includes("opp_king_uncastled")) {
    bits.push("their king is still uncastled");
  }
  if (factors.includes("own_uncastled")) {
    bits.push("your king is still uncastled");
  }
  if (!bits.length) return null;
  if (bits.length === 1) return bits[0]!;
  if (bits.length === 2) return `${bits[0]} and ${bits[1]}`;
  return `${bits.slice(0, -1).join(", ")}, and ${bits[bits.length - 1]}`;
}

function buildValuePillar(args: {
  phase: string;
  critique: boolean;
  factors: LocationFactorId[];
  liveMetrics: string[];
}): string | null {
  const consumed = new Set<string>();
  for (const f of args.factors) {
    const field = FEATURE_CONSUMES[f];
    if (field) consumed.add(field);
  }
  const labels: string[] = [];
  for (const field of args.liveMetrics) {
    if (consumed.has(field)) continue;
    if (args.phase === "opening" && !VALUE_ALLOW_OPENING.has(field)) continue;
    if (field === "opp_king_in_centre" || field === "opp_king_uncastled") continue;
    if (
      (field === "king_attackers_pct" || field === "opp_king_attackers_pct") &&
      (args.factors.includes("opp_king_centre") ||
        args.factors.includes("opp_king_uncastled"))
    ) {
      continue;
    }
    const label = VALUE_LABEL[field];
    if (!label) continue;
    if (labels.includes(label)) continue;
    labels.push(label);
    if (labels.length >= 2) break;
  }
  if (!labels.length) return null;
  const joined =
    labels.length === 1 ? labels[0]! : `${labels[0]} and ${labels[1]}`;
  if (args.critique) {
    return `${joined} explains the better move`;
  }
  const verb = labels.length === 1 ? "already works" : "already work";
  return `${joined} ${verb} for you`;
}

function composePillars(p: TipPillars): string {
  return bookJoin(
    [p.plan, p.principleLine, p.feature, p.value].filter(Boolean) as string[]
  );
}

export function buildTipCoordinate(args: {
  phase?: string | null;
  mark?: string | null;
  deltas?: MetricFieldDelta[] | null;
  situations?: DetectedSituation[] | null;
  inputs?: Record<string, string | number | boolean | null> | null;
  gamePlan?: GamePlanState | null;
  openingKeyId?: string | null;
  bestSan?: string | null;
  playedSan?: string | null;
  engineLineSans?: string[] | null;
}): TipCoordinate {
  const phase = (args.phase || "opening").toLowerCase();
  const critique =
    args.mark === "mistake" ||
    args.mark === "blunder" ||
    args.mark === "missed" ||
    args.mark === "inaccuracy";
  const polarity: TipAxisPolarity = critique ? "bad" : "good";
  const asDeltas: MetricFieldDelta[] = (args.deltas || [])
    .filter((d) => d.field)
    .map((d) => ({
      field: String(d.field),
      before: d.before ?? 0,
      after: d.after ?? Number(d.delta || 0),
      delta: d.delta ?? null,
    }));
  const ranked = rankMetricAxes({ deltas: asDeltas, phase });
  const significant = significantRankedAxes(ranked, 5);
  const wide = wideRankedAxes(ranked, 10);
  const helpingFields = ranked.filter((r) => r.helpsEngine).map((r) => r.field);
  const location = locationFromInputs(args.inputs, asDeltas, args.situations);
  const factors = collectLocationFactors(location, args.situations);
  const sitIds = (args.situations || []).map((s) => s.id).filter(Boolean);
  const inputFeats: string[] = [];
  const wing = String(args.inputs?.active_wing_user || "").toLowerCase();
  if (wing) inputFeats.push(`wing_${wing}`, wing);
  const breakClass = String(args.inputs?.pawn_break_class || "");
  if (breakClass && breakClass !== "none") inputFeats.push(breakClass);
  if (truthyFlag(args.inputs?.prefer_center_strike)) {
    inputFeats.push("prefer_center_strike", "center_strike");
  }
  const features = [
    ...featuresFromLocation(location, factors),
    ...sitIds,
    ...(args.situations || []).map((s) => s.role).filter(Boolean) as string[],
    ...inputFeats,
  ].filter((v, i, a) => a.indexOf(v) === i);
  const playedSan =
    cleanSan(args.playedSan) ||
    cleanSan(
      typeof args.inputs?.san === "string" ? args.inputs.san : null
    );
  const bestSan =
    cleanSan(args.bestSan) ||
    cleanSan(args.engineLineSans?.[0]);
  const line = followUpLine(bestSan, args.engineLineSans);
  const openingKeyId =
    args.openingKeyId || args.gamePlan?.openingKeyId || null;

  const axes: TipAxis[] = [];
  for (const row of significant) {
    const pol = polarityFromHelps(row.helpsEngine, critique);
    axes.push({
      kind: axisKindForField(row.field),
      id: row.field,
      polarity: pol,
      score: row.score,
      softKeys: keysForMetricFields([row.field]),
      phrase: phraseForAxis(row.field, pol),
      metric: row.field,
    });
  }
  for (const row of wide) {
    if (significant.some((s) => s.field === row.field)) continue;
    const pol = polarityFromHelps(row.helpsEngine, critique);
    axes.push({
      kind: axisKindForField(row.field),
      id: row.field,
      polarity: pol,
      score: row.score * 0.6,
      softKeys: keysForMetricFields([row.field]),
      phrase: phraseForAxis(row.field, pol),
      metric: row.field,
    });
  }
  for (const id of factors) {
    axes.push({
      kind: "location",
      id,
      polarity: critique ? "bad" : "neutral",
      score: 1,
      softKeys: [],
      phrase: null,
    });
  }

  const primaryField = significant[0]?.field ?? wide[0]?.field ?? null;
  const primarySoftKeys = [
    ...new Set([
      ...(primaryField ? keysForMetricFields([primaryField]) : []),
      ...wide.flatMap((r) => keysForMetricFields([r.field])).slice(0, 8),
      ...(openingKeyId ? [openingKeyId] : []),
      ...(args.gamePlan?.stickyKeys || []).slice(0, 4),
    ]),
  ].slice(0, 10);
  const liveMetrics = [
    ...new Set([
      ...significant.map((r) => r.field),
      ...wide.map((r) => r.field),
    ]),
  ].slice(0, 10);

  const pillars: TipPillars = {
    plan: buildPlanPillar({
      location,
      factors,
      phase,
      inputs: args.inputs,
      openingKeyId,
      gamePlan: args.gamePlan,
    }),
    principleLine: buildPrincipleLinePillar({
      phase,
      critique,
      factors,
      line,
      played: playedSan,
      inputs: args.inputs,
    }),
    value: buildValuePillar({
      phase,
      critique,
      factors,
      liveMetrics: helpingFields.length ? helpingFields : liveMetrics,
    }),
    feature: buildFeaturePillar(factors),
  };

  const draft: Omit<TipCoordinate, "scan"> = {
    phase,
    polarity,
    axes,
    primaryField,
    primarySoftKeys,
    liveMetrics,
    liveSituations: sitIds,
    features,
    location,
    factors,
    pillars,
    bestSan,
    playedSan,
  };
  const scan = scanPillarConditions(draft, {
    judgment: critique ? "bad" : polarity === "good" ? "good" : null,
    openings: openingKeyId ? [openingKeyId] : [],
  });
  return { ...draft, scan };
}

export function localizeTipCoordinate(coord: TipCoordinate): LocalizedTip {
  const factors =
    coord.factors.length ? coord.factors : detectLocationFactors(coord.location);
  const pillars = coord.pillars || {
    plan: null,
    principleLine: null,
    value: null,
    feature: null,
  };
  const story = Boolean(pillars.plan || pillars.principleLine || pillars.feature);
  const composed = story ? composePillars(pillars) : "";
  const metrics: string[] = [];
  const topics: string[] = [];
  if (factors.includes("queen_re_move") || factors.includes("tempo_waste") || factors.includes("knight_re_move")) {
    metrics.push("tempo_waste_rate_pct");
    topics.push("metric:tempo_waste_rate_pct");
  }
  if (factors.includes("undeveloped_minors")) {
    metrics.push("minors_developed");
    topics.push("metric:minors_developed");
  }
  if (factors.includes("opp_king_centre")) {
    metrics.push("opp_king_in_centre");
    topics.push("metric:opp_king_in_centre");
  }
  if (factors.includes("opp_king_uncastled")) {
    metrics.push("opp_king_uncastled");
    topics.push("metric:opp_king_uncastled");
  }
  for (const sit of coord.liveSituations) topics.push(`sit:${sit}`);
  for (const f of factors) topics.push(`factor:${f}`);
  if (pillars.plan) topics.push("pillar:plan");
  if (pillars.principleLine) topics.push("pillar:principle_line");
  if (pillars.value) topics.push("pillar:value");
  if (pillars.feature) topics.push("pillar:feature");
  if (pillars.value) {
    for (const field of coord.liveMetrics.slice(0, 3)) {
      if (!metrics.includes(field)) metrics.push(field);
    }
  }

  const clauses: string[] = [];
  if (composed) clauses.push(composed);

  return {
    clause: clauses[0] || null,
    clauses,
    metrics: [...new Set(metrics)].slice(0, 6),
    softKeys: [...new Set(coord.primarySoftKeys)].slice(0, 6),
    topics: [...new Set(topics)].slice(0, 10),
    factors,
    includesContext: Boolean(
      pillars.plan || pillars.principleLine || pillars.feature || pillars.value
    ),
    pillars,
  };
}

export function packNoteLocalizes(
  noteMetrics: readonly string[] | null | undefined,
  noteSoftKeys: readonly string[] | null | undefined,
  coord: TipCoordinate | null | undefined
): boolean {
  if (!coord) return false;
  const scan = coord.scan || scanPillarConditions(coord);
  const live = new Set(
    [
      ...(scan.ctx.metrics || []),
      ...(scan.ctx.features || []),
      ...(scan.ctx.softKeys || []),
      ...(scan.ctx.situations || []),
      ...scan.plan,
      ...scan.principleLine,
      ...scan.value,
      ...scan.feature,
    ].map((t) => String(t).toLowerCase().replace(/[- ]/g, "_"))
  );
  const mets = (noteMetrics || []).filter(Boolean);
  const keys = (noteSoftKeys || []).filter(Boolean);
  const hit = (tok: string) =>
    live.has(String(tok).toLowerCase().replace(/[- ]/g, "_"));
  if (mets.length && mets.some(hit)) return true;
  if (keys.length && keys.some(hit)) return true;
  if (!mets.length && !keys.length) return false;
  return false;
}
