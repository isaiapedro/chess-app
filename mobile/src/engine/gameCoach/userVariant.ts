import { colors } from "../../theme";
import type { EngineVariant, EngineVariantMove } from "./engineVariant";

export const ENGINE_VARIANT_COLOR = colors.blue;
export const GAME_LINE_COLOR = colors.sage;

export type BoardAnimStep = {
  uci: string;
  reverse?: boolean;
  fen: string;
};

export const USER_VARIANT_COLORS = [
  colors.sage,
  colors.cream,
  colors.red,
  colors.heart,
] as const;

export type UserVariantStem = {
  ply: number;
  through: number;
};

export type UserVariantRecord = {
  id: string;
  color: string;
  baseIdx: number;
  baseFen: string;
  stem: UserVariantStem | null;
  moves: EngineVariantMove[];
};

export type ExploreState = UserVariantRecord & {
  depth: number;
};

export type LineNav = {
  plyIndex: number;
  engineCursor: { plyIndex: number; depth: number } | null;
  explore: ExploreState | null;
  userVariants: UserVariantRecord[];
};

function newUserVariantId(): string {
  return `uv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function nextUserVariantColor(_existing: { color: string }[]): string {
  return GAME_LINE_COLOR;
}

export function matchesUci(stored?: string | null, played?: string | null): boolean {
  if (!stored || !played) return false;
  const a = stored.toLowerCase();
  const b = played.toLowerCase();
  if (a.slice(0, 4) !== b.slice(0, 4)) return false;
  if (a.length <= 4 || b.length <= 4) return true;
  return a[4] === b[4];
}

export function makeVariantMove(
  fenBefore: string,
  uci: string,
  san: string,
  fenAfter: string
): EngineVariantMove {
  const parts = fenBefore.split(" ");
  const fullmove = Number(parts[5]);
  return {
    san,
    uci,
    fenBefore,
    fenAfter,
    fullmove: Number.isFinite(fullmove) && fullmove > 0 ? fullmove : 1,
    side: parts[1] === "b" ? "black" : "white",
  };
}

export function lineFen(
  nav: Pick<LineNav, "plyIndex" | "engineCursor" | "explore">,
  plies: Array<{ fenBefore: string; fenAfter: string }>,
  engineVariants: Array<EngineVariant | null>,
  startFen: string
): string {
  if (nav.explore) {
    if (nav.explore.depth < 0) return nav.explore.baseFen;
    return (
      nav.explore.moves[Math.min(nav.explore.depth, nav.explore.moves.length - 1)]
        ?.fenAfter || nav.explore.baseFen
    );
  }
  if (nav.engineCursor) {
    const move =
      engineVariants[nav.engineCursor.plyIndex]?.moves[nav.engineCursor.depth];
    if (move?.fenAfter) return move.fenAfter;
  }
  if (nav.plyIndex < 0 || !plies.length) return startFen;
  return plies[Math.min(nav.plyIndex, plies.length - 1)]?.fenAfter || startFen;
}

export function activeLineColor(
  nav: Pick<LineNav, "engineCursor" | "explore">
): string | null {
  if (nav.explore) return GAME_LINE_COLOR;
  if (nav.engineCursor) return ENGINE_VARIANT_COLOR;
  return null;
}

function variantIdentity(v: Pick<UserVariantRecord, "baseIdx" | "stem" | "moves">): string {
  const stem = v.stem
    ? `s:${v.stem.ply}:${v.stem.through}`
    : `b:${v.baseIdx}`;
  const first = v.moves[0]?.uci || "";
  return `${stem}|${first}`;
}

function toRecord(explore: ExploreState): UserVariantRecord {
  return {
    id: explore.id,
    color: explore.color,
    baseIdx: explore.baseIdx,
    baseFen: explore.baseFen,
    stem: explore.stem,
    moves: explore.moves.map((m) => ({ ...m })),
  };
}

export function syncExploreToSession(
  explore: ExploreState,
  list: UserVariantRecord[]
): { explore: ExploreState; userVariants: UserVariantRecord[] } {
  if (!explore.moves.length) return { explore, userVariants: list };
  const next = list.slice();
  let i = explore.id ? next.findIndex((v) => v.id === explore.id) : -1;
  if (i < 0) {
    const key = variantIdentity(explore);
    i = next.findIndex((v) => variantIdentity(v) === key);
  }
  const id = i >= 0 ? next[i].id : newUserVariantId();
  const color = i >= 0 ? next[i].color : explore.color;
  const record: UserVariantRecord = {
    ...toRecord({ ...explore, id, color }),
    id,
    color,
  };
  if (i >= 0) next[i] = record;
  else next.push(record);
  return { explore: { ...explore, id, color }, userVariants: next };
}

export function enterUserVariant(
  list: UserVariantRecord[],
  id: string,
  depth?: number
): ExploreState | null {
  const v = list.find((x) => x.id === id);
  if (!v?.moves.length) return null;
  const max = v.moves.length - 1;
  return {
    ...v,
    moves: v.moves.map((m) => ({ ...m })),
    depth:
      depth == null ? max : Math.max(-1, Math.min(max, depth)),
  };
}

export function truncateUserVariant(
  nav: LineNav,
  id: string,
  fromDepth: number
): LineNav {
  const v = nav.userVariants.find((x) => x.id === id);
  if (!v?.moves.length) return nav;
  const cut = Math.max(0, Math.min(fromDepth, v.moves.length));
  if (cut >= v.moves.length) return nav;

  if (cut <= 0) {
    const userVariants = nav.userVariants.filter((x) => x.id !== id);
    if (nav.explore?.id !== id) {
      return { ...nav, userVariants };
    }
    if (v.stem) {
      return {
        plyIndex: v.stem.ply,
        engineCursor: { plyIndex: v.stem.ply, depth: v.stem.through },
        explore: null,
        userVariants,
      };
    }
    return {
      plyIndex: v.baseIdx,
      engineCursor: null,
      explore: null,
      userVariants,
    };
  }

  const record: UserVariantRecord = {
    ...v,
    moves: v.moves.slice(0, cut).map((m) => ({ ...m })),
  };
  const userVariants = nav.userVariants.map((x) => (x.id === id ? record : x));
  if (nav.explore?.id !== id) {
    return { ...nav, userVariants };
  }
  const entered = enterUserVariant(
    userVariants,
    id,
    Math.min(nav.explore.depth, cut - 1)
  );
  return {
    plyIndex: record.baseIdx,
    engineCursor: null,
    explore: entered,
    userVariants,
  };
}

export function stepUserExplore(
  explore: ExploreState,
  dir: -1 | 1
): {
  explore: ExploreState | null;
  plyIndex: number;
  engineCursor: LineNav["engineCursor"];
} {
  const next = explore.depth + dir;
  if (next < 0) {
    return {
      explore: null,
      plyIndex: explore.stem ? explore.stem.ply : explore.baseIdx,
      engineCursor: null,
    };
  }
  if (next >= explore.moves.length) {
    return {
      explore,
      plyIndex: explore.baseIdx,
      engineCursor: null,
    };
  }
  return {
    explore: { ...explore, depth: next },
    plyIndex: explore.baseIdx,
    engineCursor: null,
  };
}

function followTreeMove(
  nav: LineNav,
  plies: Array<{ uci: string }>,
  engineVariants: Array<EngineVariant | null>,
  uci: string
): LineNav | null {
  if (nav.explore) {
    const next = nav.explore.moves[nav.explore.depth + 1];
    if (next && matchesUci(next.uci, uci)) {
      return {
        ...nav,
        engineCursor: null,
        explore: { ...nav.explore, depth: nav.explore.depth + 1 },
        plyIndex: nav.explore.baseIdx,
      };
    }
    if (nav.explore.depth >= 0) return null;
    const { baseIdx, baseFen, stem } = nav.explore;
    const unwound: LineNav = stem
      ? {
          ...nav,
          explore: null,
          plyIndex: stem.ply,
          engineCursor: { plyIndex: stem.ply, depth: stem.through },
        }
      : {
          ...nav,
          explore: null,
          plyIndex: baseIdx,
          engineCursor: null,
        };
    const nested = followTreeMove(unwound, plies, engineVariants, uci);
    if (nested) return nested;
    return null;
  }

  if (nav.engineCursor) {
    const moves = engineVariants[nav.engineCursor.plyIndex]?.moves;
    const next = moves?.[nav.engineCursor.depth + 1];
    if (next && matchesUci(next.uci, uci)) {
      return {
        ...nav,
        explore: null,
        engineCursor: {
          plyIndex: nav.engineCursor.plyIndex,
          depth: nav.engineCursor.depth + 1,
        },
        plyIndex: nav.engineCursor.plyIndex,
      };
    }
    return null;
  }

  const nextPly = plies[nav.plyIndex + 1];
  if (nextPly && matchesUci(nextPly.uci, uci)) {
    return {
      ...nav,
      explore: null,
      engineCursor: null,
      plyIndex: nav.plyIndex + 1,
    };
  }
  const fork = engineVariants[nav.plyIndex + 1];
  const first = fork?.moves[0];
  if (first && matchesUci(first.uci, uci)) {
    return {
      ...nav,
      explore: null,
      plyIndex: nav.plyIndex + 1,
      engineCursor: { plyIndex: nav.plyIndex + 1, depth: 0 },
    };
  }
  return null;
}

export function applyBoardMove(
  nav: LineNav,
  plies: Array<{ uci: string }>,
  engineVariants: Array<EngineVariant | null>,
  currentFen: string,
  uci: string,
  san: string,
  fenAfter: string
): LineNav | null {
  const followed = followTreeMove(nav, plies, engineVariants, uci);
  if (followed) return followed;

  let explore = nav.explore;
  let userVariants = nav.userVariants;
  let plyIndex = nav.plyIndex;
  let engineCursor = nav.engineCursor;

  if (explore && explore.depth < 0) {
    plyIndex = explore.baseIdx;
    engineCursor = explore.stem
      ? { plyIndex: explore.stem.ply, depth: explore.stem.through }
      : null;
    explore = null;
  }

  if (!explore) {
    const matched = userVariants.find((v) => {
      if (engineCursor) {
        return (
          v.stem?.ply === engineCursor.plyIndex &&
          v.stem.through === engineCursor.depth &&
          matchesUci(v.moves[0]?.uci, uci)
        );
      }
      if (v.stem || v.baseIdx !== plyIndex) return false;
      return matchesUci(v.moves[0]?.uci, uci);
    });
    if (matched) {
      const entered = enterUserVariant(userVariants, matched.id, 0);
      if (!entered) return null;
      return {
        plyIndex: matched.baseIdx,
        engineCursor: null,
        explore: entered,
        userVariants,
      };
    }
    const stem = engineCursor
      ? { ply: engineCursor.plyIndex, through: engineCursor.depth }
      : null;
    explore = {
      id: "",
      color: nextUserVariantColor(userVariants),
      baseIdx: stem ? stem.ply : plyIndex,
      baseFen: currentFen,
      moves: [],
      depth: -1,
      stem,
    };
    plyIndex = explore.baseIdx;
  } else if (explore.depth < explore.moves.length - 1) {
    explore = {
      ...explore,
      moves: explore.moves.slice(0, explore.depth + 1),
    };
  }

  const record = makeVariantMove(currentFen, uci, san, fenAfter);
  explore = {
    ...explore,
    moves: [...explore.moves, record],
    depth: explore.moves.length,
  };
  const synced = syncExploreToSession(explore, userVariants);
  return {
    plyIndex,
    engineCursor: null,
    explore: synced.explore,
    userVariants: synced.userVariants,
  };
}

export function userVariantsAt(
  list: UserVariantRecord[],
  plyIdx: number,
  stemPly?: number
): UserVariantRecord[] {
  return list.filter((v) => {
    if (!v.moves.length) return false;
    if (stemPly != null) return v.stem?.ply === stemPly;
    return !v.stem && v.baseIdx === plyIdx;
  });
}

export function leaveSidelineToGame(
  nav: Pick<LineNav, "plyIndex" | "engineCursor" | "explore">
): Pick<LineNav, "plyIndex" | "engineCursor" | "explore"> {
  if (nav.explore) {
    return {
      plyIndex: nav.explore.stem?.ply ?? nav.explore.baseIdx,
      engineCursor: null,
      explore: null,
    };
  }
  if (nav.engineCursor) {
    return {
      plyIndex: nav.engineCursor.plyIndex,
      engineCursor: null,
      explore: null,
    };
  }
  return { plyIndex: nav.plyIndex, engineCursor: null, explore: null };
}

type PathNode = { uci: string; fen: string };

function mapMoves(moves: EngineVariantMove[]): PathNode[] {
  return moves.map((m) => ({ uci: m.uci, fen: m.fenAfter }));
}

function mainlinePrefix(
  plies: Array<{ uci: string; fenAfter: string }>,
  endExclusive: number
): PathNode[] {
  if (endExclusive <= 0) return [];
  return plies.slice(0, endExclusive).map((p) => ({ uci: p.uci, fen: p.fenAfter }));
}

export function linePath(
  nav: Pick<LineNav, "plyIndex" | "engineCursor" | "explore">,
  plies: Array<{ uci: string; fenAfter: string }>,
  engineVariants: Array<EngineVariant | null>
): PathNode[] {
  if (nav.explore) {
    const stem = nav.explore.stem;
    const prefix = stem
      ? [
          ...mainlinePrefix(plies, stem.ply),
          ...mapMoves(
            (engineVariants[stem.ply]?.moves || []).slice(0, stem.through + 1)
          ),
        ]
      : mainlinePrefix(plies, nav.explore.baseIdx + 1);
    if (nav.explore.depth < 0) return prefix;
    return [
      ...prefix,
      ...mapMoves(nav.explore.moves.slice(0, nav.explore.depth + 1)),
    ];
  }
  if (nav.engineCursor) {
    const at = nav.engineCursor.plyIndex;
    return [
      ...mainlinePrefix(plies, at),
      ...mapMoves(
        (engineVariants[at]?.moves || []).slice(0, nav.engineCursor.depth + 1)
      ),
    ];
  }
  return mainlinePrefix(plies, nav.plyIndex + 1);
}

export function lineSwitchAnims(
  from: Pick<LineNav, "plyIndex" | "engineCursor" | "explore">,
  to: Pick<LineNav, "plyIndex" | "engineCursor" | "explore">,
  plies: Array<{ uci: string; fenBefore: string; fenAfter: string }>,
  engineVariants: Array<EngineVariant | null>,
  startFen: string
): BoardAnimStep[] {
  const a = linePath(from, plies, engineVariants);
  const b = linePath(to, plies, engineVariants);
  let i = 0;
  while (i < a.length && i < b.length && matchesUci(a[i].uci, b[i].uci)) i += 1;
  const fenAt = (path: PathNode[], idx: number) =>
    idx < 0 ? startFen : path[idx]?.fen || startFen;
  const steps: BoardAnimStep[] = [];
  for (let k = a.length - 1; k >= i; k -= 1) {
    steps.push({ uci: a[k].uci, reverse: true, fen: fenAt(a, k - 1) });
  }
  for (let k = i; k < b.length; k += 1) {
    steps.push({ uci: b[k].uci, fen: b[k].fen });
  }
  return steps;
}

export function sidelinesVisibleAt(
  ply: number,
  nav: Pick<LineNav, "plyIndex" | "engineCursor" | "explore">
): boolean {
  if (nav.explore) {
    if (nav.explore.stem?.ply === ply) return true;
    if (!nav.explore.stem && nav.explore.baseIdx === ply) return true;
    return false;
  }
  if (nav.engineCursor?.plyIndex === ply) return true;
  return !nav.engineCursor && nav.plyIndex === ply;
}
