import { Chess } from "chess.js";

export type OpeningMixGame = {
  opening_eco?: string;
  opening_name?: string;
  user_color: string;
  result: string;
  moves_str?: string;
  pgn_str?: string;
};

export type OpeningMixBucket = {
  games: number;
  wins: number;
  win_rate: number;
};

export type OpeningMixStats = {
  games: number;
  same_opening_rate_pct: number;
  different_opening_rate_pct: number;
  orthodox_rate_pct: number;
  unorthodox_rate_pct: number;
  same_openings: OpeningMixBucket;
  different_openings: OpeningMixBucket;
  orthodox: OpeningMixBucket;
  unorthodox: OpeningMixBucket;
};

type OpeningContext =
  | "white_e4"
  | "white_d4"
  | "black_vs_e4"
  | "black_vs_d4";

const CONTEXTS: OpeningContext[] = [
  "white_e4",
  "white_d4",
  "black_vs_e4",
  "black_vs_d4",
];

const ORTHODOX_NAME_RE =
  /italian|giuoco|ruy\s*lopez|spanish\s*opening|sicilian|french\s*defen[cs]e|caro[\s-]*kann|queen'?s?\s*gambit|london\s*system|king'?s?\s*indian/i;

const FIRST_MOVE_SAN_RE =
  /1\.\s*(e4|d4|c4|Nf3|g3|b3|f4|b4|Nc3|e3|d3)\b/;

function normalizeOpeningEco(rawEco?: string): string {
  if (!rawEco || rawEco === "UNK") return "UNK";
  return String(rawEco).trim().toUpperCase();
}

function ecoNumber(eco: string): [string | null, number | null] {
  const normalized = normalizeOpeningEco(eco);
  if (normalized.length < 2 || !/^\d+$/.test(normalized.slice(1))) {
    return [null, null];
  }
  return [normalized[0], parseInt(normalized.slice(1), 10)];
}

export function isOrthodoxOpening(
  eco: string,
  openingName?: string
): boolean {
  const [letter, num] = ecoNumber(eco);
  if (letter !== null && num !== null) {
    if (
      letter === "C" &&
      (num <= 19 || (num >= 50 && num <= 59) || (num >= 60 && num <= 99))
    ) {
      return true;
    }
    if (letter === "B" && num >= 10 && num <= 99) return true;
    if (letter === "D" && num >= 6 && num <= 69) return true;
    if (letter === "E" && num >= 60 && num <= 99) return true;
  }

  if (ORTHODOX_NAME_RE.test(String(openingName || ""))) return true;
  return false;
}

function emptyBucket(): OpeningMixBucket {
  return { games: 0, wins: 0, win_rate: 0.0 };
}

function bucketGamesWr(
  games: OpeningMixGame[],
  indices: number[]
): OpeningMixBucket {
  const n = indices.length;
  if (n === 0) return emptyBucket();
  let wins = 0;
  for (const i of indices) {
    if (games[i]?.result === "Win") wins += 1;
  }
  return {
    games: n,
    wins,
    win_rate: Math.round((wins / n) * 1000) / 10,
  };
}

function ratePct(bucketGames: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((bucketGames / total) * 1000) / 10;
}

function firstWhitePawnFromText(
  pgnStr?: string,
  movesStr?: string
): "e4" | "d4" | null {
  if (pgnStr) {
    const match = FIRST_MOVE_SAN_RE.exec(pgnStr);
    if (match) {
      const token = match[1];
      if (token === "e4") return "e4";
      if (token === "d4") return "d4";
    }
  }

  if (movesStr) {
    const board = new Chess();
    for (const token of movesStr.split(/\s+/)) {
      if (!token) continue;
      try {
        const move = board.move(token);
        if (move) {
          if (move.from === "e2" && move.to === "e4") return "e4";
          if (move.from === "d2" && move.to === "d4") return "d4";
          return null;
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}

function pawnFromEco(eco: string): "e4" | "d4" | null {
  const letter = normalizeOpeningEco(eco)[0];
  if (letter === "B" || letter === "C") return "e4";
  if (letter === "D" || letter === "E") return "d4";
  return null;
}

function openingContext(
  userColor: string,
  eco: string,
  pgnStr?: string,
  movesStr?: string
): OpeningContext | null {
  const pawn =
    firstWhitePawnFromText(pgnStr, movesStr) ?? pawnFromEco(eco);
  if (!pawn) return null;

  const color = String(userColor || "").toLowerCase();
  if (color === "white") return `white_${pawn}` as OpeningContext;
  if (color === "black") return `black_vs_${pawn}` as OpeningContext;
  return null;
}

function modeValue(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

type Signature = {
  opening_eco: string | null;
  opening_name: string | null;
};

export function calculateOpeningMixStats(
  games: OpeningMixGame[]
): OpeningMixStats {
  const empty: OpeningMixStats = {
    games: 0,
    same_opening_rate_pct: 0,
    different_opening_rate_pct: 0,
    orthodox_rate_pct: 0,
    unorthodox_rate_pct: 0,
    same_openings: emptyBucket(),
    different_openings: emptyBucket(),
    orthodox: emptyBucket(),
    unorthodox: emptyBucket(),
  };

  if (!games.length) return empty;

  const ecos = games.map((g) => normalizeOpeningEco(g.opening_eco));
  const names = games.map((g) => g.opening_name || "Unknown");
  const contexts = games.map((g, i) =>
    openingContext(g.user_color, ecos[i], g.pgn_str, g.moves_str)
  );

  const signatures: Record<OpeningContext, Signature> = {
    white_e4: { opening_eco: null, opening_name: null },
    white_d4: { opening_eco: null, opening_name: null },
    black_vs_e4: { opening_eco: null, opening_name: null },
    black_vs_d4: { opening_eco: null, opening_name: null },
  };

  for (const context of CONTEXTS) {
    const idxs = contexts
      .map((c, i) => (c === context ? i : -1))
      .filter((i) => i >= 0);
    if (idxs.length === 0) continue;

    const ecoMode = modeValue(
      idxs.map((i) => ecos[i]).filter((e) => e !== "UNK")
    );
    if (ecoMode) {
      const nameInEco = modeValue(
        idxs.filter((i) => ecos[i] === ecoMode).map((i) => names[i])
      );
      signatures[context] = {
        opening_eco: ecoMode,
        opening_name: nameInEco,
      };
    } else {
      const nameMode = modeValue(idxs.map((i) => names[i]));
      signatures[context] = {
        opening_eco: null,
        opening_name: nameMode,
      };
    }
  }

  const sameIdxs: number[] = [];
  const differentIdxs: number[] = [];
  const orthodoxIdxs: number[] = [];
  const unorthodoxIdxs: number[] = [];

  for (let i = 0; i < games.length; i++) {
    const context = contexts[i];
    let same = false;
    if (context) {
      const sig = signatures[context];
      if (sig.opening_eco) {
        same = ecos[i] === sig.opening_eco;
      } else if (sig.opening_name) {
        same = names[i] === sig.opening_name;
      }
    }
    if (same) sameIdxs.push(i);
    else differentIdxs.push(i);

    if (isOrthodoxOpening(ecos[i], names[i])) orthodoxIdxs.push(i);
    else unorthodoxIdxs.push(i);
  }

  const total = games.length;
  const same_openings = bucketGamesWr(games, sameIdxs);
  const different_openings = bucketGamesWr(games, differentIdxs);
  const orthodox = bucketGamesWr(games, orthodoxIdxs);
  const unorthodox = bucketGamesWr(games, unorthodoxIdxs);

  return {
    games: total,
    same_opening_rate_pct: ratePct(same_openings.games, total),
    different_opening_rate_pct: ratePct(different_openings.games, total),
    orthodox_rate_pct: ratePct(orthodox.games, total),
    unorthodox_rate_pct: ratePct(unorthodox.games, total),
    same_openings,
    different_openings,
    orthodox,
    unorthodox,
  };
}
