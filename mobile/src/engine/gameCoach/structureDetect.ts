import { Chess, type Color, type Square } from "chess.js";
import { HEURISTICS_DOUBLED_PERSIST_PLIES } from "../analysisConfig";
import { resolveEcoFamily } from "../ecoFamilies";
import {
  hasDoubledPawns,
  hasIsolatedQueenPawn,
} from "../middlegamePhase";
import {
  isClosedCenter,
  isOppositeSideCastling,
  isMaroczyBind,
  isCarlsbad,
  isMinorityAttack,
  isCaroSlav,
  pickSicilianShell,
} from "./situationProfiles";

const FILES = "abcdefgh";

/** Themes that must persist across plies (same idea as doubled-pawn metrics). */
const PERSIST_STRUCTURE = new Set([
  "iqp",
  "doubled_pawns",
  "hanging_pawns",
  "passed_pawn",
  "pawn_chain",
  "maroczy_bind",
  "carlsbad",
  "caro_slav",
  "hedgehog",
  "scheveningen",
  "dragon_formation",
]);

/** Board structures that must survive a ply window before notes cite them. */
export const WINDOWED_STRUCTURE_THEMES = new Set([
  "iqp",
  "doubled_pawns",
  "hanging_pawns",
  "passed_pawn",
  "pawn_chain",
  "open_file",
  "open_c_file",
  "bishop_pair",
  "space",
  "minority_attack",
  "maroczy_bind",
  "carlsbad",
  "caro_slav",
  "hedgehog",
  "scheveningen",
  "dragon_formation",
]);

const STRUCTURE_WINDOW = 3;

function filePawnCounts(board: Chess, file: number): { w: number; b: number } {
  let w = 0;
  let b = 0;
  for (let r = 0; r < 8; r++) {
    const sq = `${FILES[file]}${r + 1}` as Square;
    const p = board.get(sq);
    if (!p || p.type !== "p") continue;
    if (p.color === "w") w++;
    else b++;
  }
  return { w, b };
}

function hasMajorOnFile(board: Chess, file: number, color: "w" | "b"): boolean {
  for (let r = 0; r < 8; r++) {
    const sq = `${FILES[file]}${r + 1}` as Square;
    const p = board.get(sq);
    if (p && p.color === color && (p.type === "r" || p.type === "q")) return true;
  }
  return false;
}

function countBishops(board: Chess, color: "w" | "b"): number {
  let n = 0;
  const rows = board.board();
  for (const row of rows) {
    for (const p of row) {
      if (p && p.color === color && p.type === "b") n++;
    }
  }
  return n;
}

function hangingCd(board: Chess, color: "w" | "b"): boolean {
  const b = filePawnCounts(board, 1);
  const c = filePawnCounts(board, 2);
  const d = filePawnCounts(board, 3);
  const e = filePawnCounts(board, 4);
  const own = (x: { w: number; b: number }) => (color === "w" ? x.w : x.b);
  return (
    own(c) >= 1 &&
    own(d) >= 1 &&
    own(b) === 0 &&
    own(e) === 0
  );
}

function passedPawnPresent(board: Chess): boolean {
  for (let f = 0; f < 8; f++) {
    for (const color of ["w", "b"] as const) {
      for (let r = 0; r < 8; r++) {
        const sq = `${FILES[f]}${r + 1}` as Square;
        const p = board.get(sq);
        if (!p || p.type !== "p" || p.color !== color) continue;
        const ahead =
          color === "w"
            ? Array.from({ length: 7 - r }, (_, i) => r + 2 + i)
            : Array.from({ length: r }, (_, i) => r - i);
        let blocked = false;
        for (const rank of ahead) {
          for (const df of [-1, 0, 1]) {
            const ff = f + df;
            if (ff < 0 || ff > 7) continue;
            const s2 = `${FILES[ff]}${rank}` as Square;
            const q = board.get(s2);
            if (q?.type === "p" && q.color !== color) {
              blocked = true;
              break;
            }
          }
          if (blocked) break;
        }
        if (!blocked) return true;
      }
    }
  }
  return false;
}

function hasPawnChain(board: Chess, color: Color): boolean {
  const pawns: Array<{ f: number; r: number }> = [];
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const sq = `${FILES[f]}${r + 1}` as Square;
      const p = board.get(sq);
      if (!p || p.type !== "p" || p.color !== color) continue;
      pawns.push({ f, r });
    }
  }
  if (pawns.length < 3) return false;
  let links = 0;
  for (let i = 0; i < pawns.length; i++) {
    for (let j = i + 1; j < pawns.length; j++) {
      const df = Math.abs(pawns[i].f - pawns[j].f);
      const dr = Math.abs(pawns[i].r - pawns[j].r);
      if (df === 1 && dr === 1) links += 1;
    }
  }
  return links >= 2;
}

/**
 * Instant board scan (may flicker). Prefer StructureThemeTracker for notes.
 */
export function detectStructureThemes(fen: string): string[] {
  const themes: string[] = [];
  try {
    const board = new Chess(fen);
    const colors: Color[] = ["w", "b"];
    if (colors.some((c) => hasIsolatedQueenPawn(board, c))) {
      themes.push("iqp");
    }
    if (colors.some((c) => hasDoubledPawns(board, c))) {
      themes.push("doubled_pawns");
    }
    if (hangingCd(board, "w") || hangingCd(board, "b")) {
      themes.push("hanging_pawns");
    }
    if (colors.some((c) => hasPawnChain(board, c))) {
      themes.push("pawn_chain");
    }
    for (let f = 0; f < 8; f++) {
      const { w, b } = filePawnCounts(board, f);
      if (w === 0 && b === 0) {
        if (hasMajorOnFile(board, f, "w") || hasMajorOnFile(board, f, "b")) {
          themes.push(f === 2 ? "open_c_file" : "open_file");
          break;
        }
      }
    }
    const wb = countBishops(board, "w");
    const bb = countBishops(board, "b");
    if ((wb >= 2 && bb < 2) || (bb >= 2 && wb < 2)) {
      themes.push("bishop_pair");
    }
    if (passedPawnPresent(board)) {
      themes.push("passed_pawn");
    }
    let wAdv = 0;
    let bAdv = 0;
    for (let f = 0; f < 8; f++) {
      for (let r = 0; r < 8; r++) {
        const sq = `${FILES[f]}${r + 1}` as Square;
        const p = board.get(sq);
        if (!p || p.type !== "p") continue;
        if (p.color === "w" && r >= 4) wAdv++;
        if (p.color === "b" && r <= 3) bAdv++;
      }
    }
    if (Math.abs(wAdv - bAdv) >= 3) themes.push("space");
    if (isClosedCenter(board)) themes.push("closed_center");
    if (isOppositeSideCastling(board)) themes.push("opposite_side_castling");
    if (isMaroczyBind(board)) themes.push("maroczy_bind");
    if (isCarlsbad(board)) {
      themes.push("carlsbad");
      if (isMinorityAttack(board)) themes.push("minority_attack");
    }
    if (isCaroSlav(board)) themes.push("caro_slav");
    const shell = pickSicilianShell(board);
    if (shell) themes.push(shell.id);
  } catch {
    /* ignore */
  }
  return themes;
}

/**
 * Windowed structure for notes: theme must survive the move (before∩after)
 * and show up across recent plies — not a one-frame snapshot.
 */
export class StructureThemeTracker {
  private history: string[][] = [];
  private streaks = new Map<string, number>();

  update(fenBefore: string, fenAfter: string): string[] {
    const beforeRaw = detectStructureThemes(fenBefore);
    const afterRaw = detectStructureThemes(fenAfter);
    const beforeSet = new Set(beforeRaw);
    const afterSet = new Set(afterRaw);

    for (const theme of PERSIST_STRUCTURE) {
      if (afterSet.has(theme)) {
        this.streaks.set(theme, (this.streaks.get(theme) || 0) + 1);
      } else {
        this.streaks.set(theme, 0);
      }
    }

    this.history.push(afterRaw);
    if (this.history.length > 5) this.history.shift();

    const window = this.history.slice(-STRUCTURE_WINDOW);
    const needHits = window.length >= 2 ? 2 : 1;
    const out: string[] = [];

    for (const t of afterRaw) {
      if (!beforeSet.has(t)) continue;
      if (PERSIST_STRUCTURE.has(t)) {
        const streak = this.streaks.get(t) || 0;
        if (streak < HEURISTICS_DOUBLED_PERSIST_PLIES) continue;
      }
      const hits = window.filter((h) => h.includes(t)).length;
      if (hits < needHits) continue;
      out.push(t);
    }
    return out;
  }
}

export type StructureFeature = {
  theme: string;
  owner: "user" | "opponent" | "both";
  /** e.g. "doubled c-pawns", "d-pawn isolani", "hanging c/d-pawns" */
  label: string;
};

function doubledPawnFiles(board: Chess, color: Color): number[] {
  const files: number[] = [];
  for (let f = 0; f < 8; f++) {
    let count = 0;
    for (let r = 0; r < 8; r++) {
      const p = board.get(`${FILES[f]}${r + 1}` as Square);
      if (p && p.type === "p" && p.color === color) count += 1;
    }
    if (count >= 2) files.push(f);
  }
  return files;
}

function passedPawnFiles(board: Chess, color: Color): number[] {
  const files: number[] = [];
  for (let f = 0; f < 8; f++) {
    for (let r = 0; r < 8; r++) {
      const sq = `${FILES[f]}${r + 1}` as Square;
      const p = board.get(sq);
      if (!p || p.type !== "p" || p.color !== color) continue;
      const ahead =
        color === "w"
          ? Array.from({ length: 7 - r }, (_, i) => r + 2 + i)
          : Array.from({ length: r }, (_, i) => r - i);
      let blocked = false;
      for (const rank of ahead) {
        for (const df of [-1, 0, 1]) {
          const ff = f + df;
          if (ff < 0 || ff > 7) continue;
          const q = board.get(`${FILES[ff]}${rank}` as Square);
          if (q?.type === "p" && q.color !== color) {
            blocked = true;
            break;
          }
        }
        if (blocked) break;
      }
      if (!blocked) {
        files.push(f);
        break;
      }
    }
  }
  return files;
}

function fileListLabel(files: number[]): string {
  if (!files.length) return "";
  if (files.length === 1) return `${FILES[files[0]]}-pawn`;
  if (files.length === 2) {
    return `${FILES[files[0]]}/${FILES[files[1]]}-pawns`;
  }
  return `${files.map((f) => FILES[f]).join("")}-pawns`;
}

function ownerFor(
  userHas: boolean,
  oppHas: boolean
): "user" | "opponent" | "both" | null {
  if (userHas && oppHas) return "both";
  if (userHas) return "user";
  if (oppHas) return "opponent";
  return null;
}

/**
 * Side-aware pawn-structure labels for notes (whose pawns + which file).
 */
export function describeStructureFeatures(
  fen: string,
  userColor: "white" | "black"
): StructureFeature[] {
  const out: StructureFeature[] = [];
  try {
    const board = new Chess(fen);
    const user: Color = userColor === "white" ? "w" : "b";
    const opp: Color = user === "w" ? "b" : "w";

    const userIqp = hasIsolatedQueenPawn(board, user);
    const oppIqp = hasIsolatedQueenPawn(board, opp);
    const iqpOwner = ownerFor(userIqp, oppIqp);
    if (iqpOwner) {
      out.push({
        theme: "iqp",
        owner: iqpOwner,
        label:
          iqpOwner === "both"
            ? "d-pawn isolanis"
            : iqpOwner === "user"
              ? "your d-pawn isolani"
              : "their d-pawn isolani",
      });
    }

    const userDbl = doubledPawnFiles(board, user);
    const oppDbl = doubledPawnFiles(board, opp);
    const dblOwner = ownerFor(userDbl.length > 0, oppDbl.length > 0);
    if (dblOwner) {
      const files =
        dblOwner === "user"
          ? userDbl
          : dblOwner === "opponent"
            ? oppDbl
            : userDbl.length
              ? userDbl
              : oppDbl;
      const core =
        files.length === 1
          ? `doubled ${FILES[files[0]]}-pawns`
          : `doubled ${files.map((f) => FILES[f]).join("/")}-pawns`;
      out.push({
        theme: "doubled_pawns",
        owner: dblOwner,
        label:
          dblOwner === "user"
            ? `your ${core}`
            : dblOwner === "opponent"
              ? `their ${core}`
              : core,
      });
    }

    const userHang = hangingCd(board, user);
    const oppHang = hangingCd(board, opp);
    const hangOwner = ownerFor(userHang, oppHang);
    if (hangOwner) {
      out.push({
        theme: "hanging_pawns",
        owner: hangOwner,
        label:
          hangOwner === "user"
            ? "your hanging c/d-pawns"
            : hangOwner === "opponent"
              ? "their hanging c/d-pawns"
              : "hanging c/d-pawns",
      });
    }

    const userChain = hasPawnChain(board, user);
    const oppChain = hasPawnChain(board, opp);
    const chainOwner = ownerFor(userChain, oppChain);
    if (chainOwner) {
      out.push({
        theme: "pawn_chain",
        owner: chainOwner,
        label:
          chainOwner === "user"
            ? "your pawn chain"
            : chainOwner === "opponent"
              ? "their pawn chain"
              : "the pawn chain",
      });
    }

    const userPass = passedPawnFiles(board, user);
    const oppPass = passedPawnFiles(board, opp);
    const passOwner = ownerFor(userPass.length > 0, oppPass.length > 0);
    if (passOwner) {
      const files =
        passOwner === "user"
          ? userPass
          : passOwner === "opponent"
            ? oppPass
            : [...userPass, ...oppPass];
      const fl = fileListLabel(files);
      const core = files.length === 1 ? `passed ${FILES[files[0]]}-pawn` : `passed ${fl}`;
      out.push({
        theme: "passed_pawn",
        owner: passOwner,
        label:
          passOwner === "user"
            ? `your ${core}`
            : passOwner === "opponent"
              ? `their ${core}`
              : core,
      });
    }
  } catch {
    /* ignore */
  }
  return out;
}

/**
 * Soft opening themes for RAG + phase plans (from ECO family / name).
 */
export function detectOpeningFamily(
  eco?: string | null,
  opening?: string | null
): string[] {
  const tags: string[] = [];
  const ecoU = String(eco || "").trim().toUpperCase();
  const name = String(opening || "").toLowerCase();
  if (!ecoU && !name) return [];

  tags.push("named_opening");
  tags.push("opening_plan");

  const fam = resolveEcoFamily(ecoU || null, opening || null);
  const key = fam?.key || "";
  if (key.includes("sicilian") || name.includes("sicilian")) {
    tags.push("opening_sicilian");
    if (name.includes("najdorf")) tags.push("opening_najdorf");
    if (name.includes("dragon")) tags.push("opening_dragon");
    if (name.includes("scheveningen")) tags.push("opening_scheveningen");
  }
  if (key.includes("french") || name.includes("french")) {
    tags.push("opening_french");
    tags.push("opening_french_defence");
  }
  if (key.includes("caro") || name.includes("caro")) {
    tags.push("opening_caro_kann");
  }
  if (
    key.includes("qgd") ||
    key.includes("qga") ||
    key.includes("slav") ||
    name.includes("queen's gambit") ||
    name.includes("queens gambit") ||
    name.includes("qgd") ||
    name.includes("slav")
  ) {
    tags.push("opening_queens_gambit");
    tags.push("opening_qgd");
  }
  if (key.includes("kings-indian") || name.includes("king's indian") || name.includes("kings indian")) {
    tags.push("opening_kings_indian");
    tags.push("opening_indian");
  }
  if (key.includes("grunfeld") || name.includes("grünfeld") || name.includes("grunfeld")) {
    tags.push("opening_indian");
  }
  if (key.includes("london") || name.includes("london")) {
    tags.push("opening_london");
  }
  if (key.includes("ruy") || name.includes("ruy lopez") || name.includes("spanish")) {
    tags.push("opening_ruy_lopez");
  }
  if (key.includes("italian") || name.includes("italian") || name.includes("giuoco")) {
    tags.push("opening_italian");
  }
  if (key.includes("scandinavian") || name.includes("scandinavian") || name.includes("center counter")) {
    tags.push("opening_scandinavian");
  }
  if (key.includes("petroff") || name.includes("petroff") || name.includes("russian")) {
    tags.push("opening_petroff");
  }
  if (key.includes("english") || name.includes("english opening") || name === "english") {
    tags.push("opening_english");
  }
  if (name.includes("najdorf")) tags.push("opening_najdorf");
  if (name.includes("dragon")) tags.push("opening_dragon");

  return [...new Set(tags)];
}

const OPENING_TAG_TO_PACK: Record<string, string> = {
  opening_sicilian: "opening.sicilian",
  opening_najdorf: "opening.sicilian",
  opening_dragon: "opening.sicilian",
  opening_scheveningen: "opening.sicilian",
  opening_french: "opening.french",
  opening_french_defence: "opening.french",
  opening_caro_kann: "opening.caro_kann",
  opening_queens_gambit: "opening.queens_gambit",
  opening_qgd: "opening.queens_gambit",
  opening_kings_indian: "opening.kings_indian",
  opening_london: "opening.london_system",
  opening_ruy_lopez: "opening.ruy_lopez",
  opening_italian: "opening.italian",
  opening_scandinavian: "opening.scandinavian",
  opening_petroff: "opening.petroff",
  opening_english: "opening.english",
};

const ECO_FAMILY_TO_PACK: Record<string, string> = {
  "b-sicilian": "opening.sicilian",
  "c-french": "opening.french",
  "b-caro-kann": "opening.caro_kann",
  "d-qgd": "opening.queens_gambit",
  "d-qga": "opening.queens_gambit",
  "d-slav": "opening.queens_gambit",
  "e-kings-indian": "opening.kings_indian",
  "a-london": "opening.london_system",
  "a-anti-indian": "opening.london_system",
  "c-ruy-lopez": "opening.ruy_lopez",
  "c-italian": "opening.italian",
  "b-scandinavian": "opening.scandinavian",
  "c-petroff": "opening.petroff",
  "a-english": "opening.english",
};

/**
 * Hard pack key for this game's opening from ECO / opening name.
 * Prefer specific tags from detectOpeningFamily, then ECO family map.
 */
export function resolveOpeningPackKey(
  eco?: string | null,
  opening?: string | null
): string | null {
  const tags = detectOpeningFamily(eco, opening);
  for (const t of tags) {
    const kid = OPENING_TAG_TO_PACK[t];
    if (kid) return kid;
  }
  const fam = resolveEcoFamily(
    String(eco || "").trim().toUpperCase() || null,
    opening || null
  );
  if (fam?.key && ECO_FAMILY_TO_PACK[fam.key]) {
    return ECO_FAMILY_TO_PACK[fam.key];
  }
  return null;
}
