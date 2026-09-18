import type { DerivedCoachEntry } from "./derivedCoachPack";
import {
  formatKeyTipAsConcept,
  pickMomentKey,
  type MomentEvent,
} from "./keyRetrieve";

export type RetrieveContext = {
  themes: string[];
  phase?: "opening" | "middlegame" | "endgame";
  wantCount?: number;
  strict?: boolean;
  /** @deprecated Unused for tip pick (metric/theme path). */
  fen?: string;
  /** @deprecated Unused for tip pick (metric/theme path). */
  san?: string;
  bestSan?: string | null;
  eco?: string | null;
  opening?: string | null;
  /** @deprecated Unused for tip pick (metric/theme path). */
  recentSans?: string[];
  gameKeys?: DerivedCoachEntry[];
  momentEvent?: MomentEvent;
};

export type KnowledgeNugget = {
  cardId: string;
  label: string;
  text: string;
  source?: "derived" | "vector";
  quality?: string;
};

export type VectorRetrieveFn = (
  ctx: RetrieveContext,
  usedIds: Set<string>
) => Promise<KnowledgeNugget[]>;

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function fingerprint(text: string): string {
  const norm = normalizeText(text);
  const words = norm.split(" ").filter((w) => w.length > 3);
  return words.slice(0, 12).join(" ");
}

/**
 * Soft-key tip for this moment (phase + theme/ECO weights).
 * One tip max — latest derived pack only. No FEN/SAN matching.
 */
export function retrieveDerivedCoachNuggets(
  ctx: RetrieveContext,
  usedIds: Set<string>
): KnowledgeNugget[] {
  const want = Math.max(0, Math.min(ctx.wantCount ?? 1, 2));
  if (want === 0) return [];

  const tip = pickMomentKey({
    gameKeys: ctx.gameKeys || [],
    phase: ctx.phase || "middlegame",
    themes: ctx.themes || [],
    recentSans: [],
    eco: ctx.eco,
    opening: ctx.opening,
    event: ctx.momentEvent || "accuracy",
    excludeNoteIds: new Set(
      [...usedIds]
        .filter((id) => id.startsWith("noteId:"))
        .map((id) => id.slice("noteId:".length))
    ),
  });
  if (!tip) return [];

  const uid = tip.noteId
    ? `noteId:${tip.noteId}`
    : `derived:${tip.keyId}:${fingerprint(tip.text || "")}`;
  if (usedIds.has(uid)) return [];
  const text = formatKeyTipAsConcept(tip);
  const fp = fingerprint(text);
  if (!fp || usedIds.has(`fp:${fp}`)) return [];
  usedIds.add(uid);
  usedIds.add(`fp:${fp}`);

  return [
    {
      cardId: uid,
      label: tip.label,
      text,
      source: "derived",
      quality: "key_summary",
    },
  ];
}

/**
 * Derived pack only. Optional remote vector fills gaps when provided.
 * No static template / knowledge-pack fallback.
 */
export async function mergeHybridKnowledgeNuggets(
  ctx: RetrieveContext,
  usedIds: Set<string>,
  retrieveVector?: VectorRetrieveFn | null
): Promise<KnowledgeNugget[]> {
  const want = Math.max(0, Math.min(ctx.wantCount ?? 1, 1));
  if (want === 0) return [];

  const out: KnowledgeNugget[] = [
    ...retrieveDerivedCoachNuggets({ ...ctx, wantCount: want }, usedIds),
  ];

  if (retrieveVector && out.length < want) {
    try {
      const remote = await retrieveVector(
        { ...ctx, wantCount: want - out.length },
        usedIds
      );
      for (const n of remote) {
        if (out.length >= want) break;
        const fp = fingerprint(n.text);
        if (!fp || usedIds.has(`fp:${fp}`) || usedIds.has(n.cardId)) continue;
        usedIds.add(n.cardId);
        usedIds.add(`fp:${fp}`);
        out.push({ ...n, source: n.source || "vector" });
      }
    } catch {
      /* soft-fail */
    }
  }

  return out;
}
