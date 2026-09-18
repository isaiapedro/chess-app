import { Chess } from "chess.js";
import {
  OPENING_LINES_BY_NAME,
  type OpeningLineRef,
} from "./openingLines.generated";

export type { OpeningLineRef };

const MIN_MATCH_RATIO = 0.6;

export function normalizeOpeningName(name?: string | null): string {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/defence/g, "defense")
    .replace(/pelikan/g, "pelican")
    .replace(/[’']/g, "'")
    .replace(/[,:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function epdFromFen(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

export function openingNamesMatch(
  left?: string | null,
  right?: string | null
): boolean {
  const a = normalizeOpeningName(left);
  const b = normalizeOpeningName(right);
  if (!a || !b) return false;
  return a === b;
}

export function openingNameIsParentOrEqual(
  parent?: string | null,
  full?: string | null
): boolean {
  const a = normalizeOpeningName(parent);
  const b = normalizeOpeningName(full);
  if (!a || !b) return false;
  return a === b || b.startsWith(`${a} `);
}

export function lookupOpeningLine(
  name?: string | null,
  eco?: string | null
): OpeningLineRef | null {
  const q = normalizeOpeningName(name);
  if (!q) return null;
  const ecoCode = String(eco || "")
    .toUpperCase()
    .trim();

  const direct = OPENING_LINES_BY_NAME[q];
  if (direct && (!ecoCode || ecoCode === "UNK" || direct.eco === ecoCode)) {
    return direct;
  }

  let best: OpeningLineRef | null = null;
  let bestScore = -1;
  for (const [key, ref] of Object.entries(OPENING_LINES_BY_NAME)) {
    if (!(q === key || q.startsWith(`${key} `) || key.startsWith(`${q} `))) {
      continue;
    }
    let score = key.length;
    if (q === key) score += 100000;
    else if (q.startsWith(`${key} `)) score += 50000;
    if (ecoCode && ecoCode !== "UNK" && ref.eco === ecoCode) score += 20000;
    if (score > bestScore) {
      bestScore = score;
      best = ref;
    }
  }
  return best;
}

function referencePositions(refUcis: string[]): Set<string> {
  const board = new Chess();
  const epds = new Set<string>([epdFromFen(board.fen())]);
  for (const uci of refUcis) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.slice(4) || undefined;
    let moved;
    try {
      moved = board.move({ from, to, promotion });
    } catch {
      moved = null;
    }
    if (!moved) break;
    epds.add(epdFromFen(board.fen()));
  }
  return epds;
}

/**
 * Last ply of the named variation inside this game.
 *
 * Games reach the same named line through different move orders and with
 * substitute moves (Nf3 for Nb5), so an exact replay of the reference line
 * rarely matches. We take the deepest ply that either transposes into a
 * reference position or plays one of the reference moves, as long as enough of
 * the reference line has been seen.
 */
export function variationEndPlyFromMap(
  name: string | null | undefined,
  eco: string | null | undefined,
  sans: string[]
): number | null {
  const ref = lookupOpeningLine(name, eco);
  if (!ref) return null;

  const refUcis = String(ref.uci || "").split(" ").filter(Boolean);
  if (!refUcis.length) return ref.ply;

  const refPositions = referencePositions(refUcis);
  const remaining = new Map<string, number>();
  for (const uci of refUcis) {
    remaining.set(uci, (remaining.get(uci) || 0) + 1);
  }

  const maxPly = Math.min(sans.length, refUcis.length + 4);
  const board = new Chess();
  let matched = 0;
  let lastCommonPly: number | null = null;
  let lastTransposedPly: number | null = null;

  for (let i = 0; i < maxPly; i += 1) {
    let moved;
    try {
      moved = board.move(sans[i]);
    } catch {
      moved = null;
    }
    if (!moved) break;

    const uci = `${moved.from}${moved.to}${moved.promotion || ""}`;
    const left = remaining.get(uci) || 0;
    if (left > 0) {
      remaining.set(uci, left - 1);
      matched += 1;
      lastCommonPly = i + 1;
    }
    if (refPositions.has(epdFromFen(board.fen()))) {
      lastTransposedPly = i + 1;
      lastCommonPly = i + 1;
    }
  }

  if (lastTransposedPly == null && lastCommonPly == null) {
    return Math.min(ref.ply, sans.length);
  }

  const ratioOk = matched / refUcis.length >= MIN_MATCH_RATIO;
  const candidates = [lastTransposedPly ?? 0, ratioOk ? lastCommonPly ?? 0 : 0];
  const end = Math.max(...candidates);
  return end > 0 ? end : Math.min(ref.ply, sans.length);
}
