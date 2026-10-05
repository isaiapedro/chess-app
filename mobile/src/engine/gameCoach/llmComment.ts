import type { CoachEvent } from "./coachEvent";
import { CHECKPOINT_KINDS } from "./coachEvent";
import type { TacticalFact } from "./tacticalFact";
import { formatTacticalFactHead } from "./tacticalFact";

const GENERIC_RE =
  /compare forcing replies|keep pieces active|look at candidates|weigh the engine alternative|hold the same standard/i;

const TACTICAL_KEY: Record<string, string> = {
  trapped_piece: "motif.trapped_piece",
  hung_mate: "motif.mate_threat",
  missed_mate: "motif.mate_threat",
  gave_piece: "motif.hanging_piece",
  missed_capture: "motif.hanging_piece",
  missed_tactic: "motif.fork",
};

export type CoachLlmTask = "mistake" | "praise" | "checkpoint";

export type CoachLlmPayload = {
  ply: number | null;
  playedMove: string | null;
  bestMove: string | null;
  mark: string | null;
  dropCp: number;
  tacticalHead: string | null;
  tacticalKind: string | null;
  selfInflicted: boolean;
  whyBetter: string | null;
  playedLine: string | null;
  engineLine: string | null;
  playedImpact: string | null;
  technicalRule: string | null;
  structuralKind: string | null;
  praiseMark: string | null;
  piece: string | null;
  square: string | null;
  keyId: string | null;
  eventKind: string | null;
  task: CoachLlmTask;
};

export type CoachCommentSource = "llm" | "stitch" | "catalog";

function str(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function inputStr(
  inputs: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  if (!inputs) return null;
  return str(inputs[key]);
}

export function taskForEvent(event: CoachEvent | null | undefined): CoachLlmTask {
  if (!event) return "mistake";
  if (event.kind === "praise") return "praise";
  if (event.kind === "fixed_checkpoint") return "checkpoint";
  return "mistake";
}

export function keyIdForLlmPayload(payload: CoachLlmPayload): string {
  if (payload.keyId) return payload.keyId;
  const kind = payload.tacticalKind || "";
  if (kind && TACTICAL_KEY[kind]) return TACTICAL_KEY[kind];
  const structural = payload.structuralKind || "";
  if (CHECKPOINT_KINDS.includes(structural as (typeof CHECKPOINT_KINDS)[number])) {
    return `checkpoint.${structural}`;
  }
  const praise = payload.praiseMark || payload.mark || "";
  if (praise === "brilliant") return "praise.brilliant";
  if (praise === "excellent" || praise === "great_find") return "praise.great_find";
  return "methodology.comparison_and_elimination";
}

export function buildCoachLlmPayload(args: {
  ply?: number | null;
  playedSan?: string | null;
  bestSan?: string | null;
  mark?: string | null;
  dropCp?: number | null;
  event?: CoachEvent | null;
  tacticalFact?: TacticalFact | null;
  structuralKind?: string | null;
  praiseMark?: string | null;
  inputs?: Record<string, unknown> | null;
  keyId?: string | null;
}): CoachLlmPayload {
  const fact = args.tacticalFact || null;
  const inputs = args.inputs || {};
  const tacticalKind =
    fact?.kind || inputStr(inputs, "tactical_kind") || null;
  const payload: CoachLlmPayload = {
    ply: args.ply ?? null,
    playedMove: str(args.playedSan),
    bestMove: str(args.bestSan),
    mark: str(args.mark),
    dropCp: Math.max(0, Math.round(Number(args.dropCp) || 0)),
    tacticalHead:
      inputStr(inputs, "tactical_head") ||
      (fact?.kind ? formatTacticalFactHead(fact) : null),
    tacticalKind,
    selfInflicted: Boolean(
      fact?.selfInflicted || inputs.tactical_self_inflicted
    ),
    whyBetter: inputStr(inputs, "why_better"),
    playedLine: inputStr(inputs, "played_line"),
    engineLine: inputStr(inputs, "engine_line"),
    playedImpact: inputStr(inputs, "played_impact"),
    technicalRule: inputStr(inputs, "technical_rule"),
    structuralKind: str(args.structuralKind) || inputStr(inputs, "structural_kind"),
    praiseMark: str(args.praiseMark) || inputStr(inputs, "praise_mark"),
    piece: fact?.pieceLabel || inputStr(inputs, "tactical_piece"),
    square: fact?.trapSquare || inputStr(inputs, "tactical_square"),
    keyId: str(args.keyId) || inputStr(inputs, "key_id"),
    eventKind: args.event?.kind || null,
    task: taskForEvent(args.event),
  };
  if (!payload.keyId) payload.keyId = keyIdForLlmPayload(payload);
  return payload;
}

function clipSentences(text: string, limit = 2): string {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const bits = raw.split(/(?<=[.!?])\s+/).map((b) => b.trim()).filter(Boolean);
  let out = bits.slice(0, limit).join(" ").trim();
  if (out && !/[.!?]$/.test(out)) out += ".";
  return out;
}

export function commentIsConcrete(text: string): boolean {
  const t = String(text || "").trim();
  if (t.length < 24) return false;
  if (GENERIC_RE.test(t)) return false;
  return true;
}

export function stitchCoachComment(payload: CoachLlmPayload): string {
  const played = payload.playedMove || "that move";
  const best = payload.bestMove;
  const head = String(payload.tacticalHead || "").trim().replace(/[.]+$/, "");
  const why = String(payload.whyBetter || "").trim().replace(/[.]+$/, "");
  const impact = String(payload.playedImpact || "").trim().replace(/[.]+$/, "");
  const parts: string[] = [];
  if (payload.task === "praise") {
    parts.push(`${played} is the right idea.`);
    if (best && best !== played) parts.push(`Engine agrees with ${best}.`);
  } else if (head) {
    parts.push(`${played} — ${head}.`);
  } else if (impact) {
    parts.push(`${played} ${impact[0].toLowerCase()}${impact.slice(1)}.`);
  } else if (why) {
    parts.push(`${played} conceded the better idea (${why}).`);
  } else {
    parts.push(`${played} dropped the evaluation.`);
  }
  if (payload.task !== "praise" && best) {
    parts.push(`Best was ${best}.`);
  }
  return clipSentences(parts.join(" "));
}

function commentApiBase(override?: string): string {
  if (override) return String(override).replace(/\/$/, "");
  const fromEnv =
    typeof process !== "undefined"
      ? process.env.EXPO_PUBLIC_API_URL || process.env.CHESS_API_URL
      : "";
  if (fromEnv) return String(fromEnv).replace(/\/$/, "");
  return "http://127.0.0.1:8000";
}

export function payloadToApiMoment(payload: CoachLlmPayload): Record<string, unknown> {
  return {
    ply: payload.ply,
    playedMove: payload.playedMove,
    bestMove: payload.bestMove,
    mark: payload.mark,
    dropCp: payload.dropCp,
    tacticalHead: payload.tacticalHead,
    tacticalKind: payload.tacticalKind,
    selfInflicted: payload.selfInflicted,
    whyBetter: payload.whyBetter,
    playedLine: payload.playedLine,
    engineLine: payload.engineLine,
    playedImpact: payload.playedImpact,
    technicalRule: payload.technicalRule,
    structuralKind: payload.structuralKind,
    praiseMark: payload.praiseMark,
    piece: payload.piece,
    square: payload.square,
    keyId: payload.keyId,
  };
}

export async function fetchLlmComments(
  payloads: CoachLlmPayload[],
  options?: { timeoutMs?: number; apiBase?: string }
): Promise<(string | null)[]> {
  if (!payloads.length) return [];
  const url = `${commentApiBase(options?.apiBase)}/api/v1/coach/comments`;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options?.timeoutMs ?? 120000
  );
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ moments: payloads.map(payloadToApiMoment) }),
      signal: controller.signal,
    });
    if (!res.ok) return payloads.map(() => null);
    const body = (await res.json()) as { comments?: Array<{ text?: string }> };
    const comments = Array.isArray(body.comments) ? body.comments : [];
    return payloads.map((_, i) => {
      const text = clipSentences(String(comments[i]?.text || ""));
      return commentIsConcrete(text) ? text : null;
    });
  } catch {
    return payloads.map(() => null);
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveLlmComments(
  payloads: CoachLlmPayload[],
  fallbacks: string[],
  options?: { enabled?: boolean; timeoutMs?: number; apiBase?: string }
): Promise<{ texts: string[]; sources: CoachCommentSource[] }> {
  const texts = fallbacks.map((t) => String(t || "").trim());
  const sources: CoachCommentSource[] = texts.map(() => "catalog");
  if (options?.enabled === false) {
    return { texts, sources };
  }
  const llm = await fetchLlmComments(payloads, {
    timeoutMs: options?.timeoutMs,
    apiBase: options?.apiBase,
  });
  for (let i = 0; i < payloads.length; i += 1) {
    const fromLlm = llm[i];
    if (fromLlm) {
      texts[i] = fromLlm;
      sources[i] = "llm";
      continue;
    }
    const stitched = stitchCoachComment(payloads[i]!);
    if (stitched) {
      texts[i] = stitched;
      sources[i] = "stitch";
    }
  }
  return { texts, sources };
}
