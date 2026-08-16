/**
 * Reformat pack excerpts into position coaching notes:
 * plans / structures / ideas / motifs / tactics / principles only.
 * Strip books, chapters, games, move sequences.
 */

const SOFT_MAX = 420;

const SECTION_TITLES =
  "Plans and ideas|Structures|Move types and motifs|Conditional positions|" +
  "Openings|Games and notes|Related games|Excerpts|Plans|Ideas|Themes";

const SAN_TOKEN =
  String.raw`(?:O-O-O|O-O|0-0-0|0-0|[NBRQK][a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQ])?[+#]?|[a-h]x[a-h][1-8](?:=[NBRQ])?[+#]?|[a-h][1-8](?:=[NBRQ])?[+#])`;

const SAN_OR_PAWN =
  String.raw`(?:${SAN_TOKEN}|[a-h][1-8])`;

const CONCEPT_RE =
  /\b(plan|plans|idea|ideas|structure|structures|motif|motifs|tactic|tactics|principle|principles|attack|defence|defense|blockade|isolani|iqp|passer|passed.?pawn|outpost|initiative|prophylaxis|sacrifice|pin|fork|skewer|space|imbalance|development|develop|developed|castle|castling|king.?safety|pawn.?break|minority|hanging|doubled|pawn.?chain|open.?file|diagonal|coordination|centrali[sz]e[ds]?|centrali[sz]ation|centre|center|simplification|conversion|restriction|compensation|tempo|zugzwang|opposition|lucena|philidor|fortress|triangulation|candidate|comparison|visualization|weakness|two.?weaknesses|color.?complex|good.?bishop|bad.?bishop|bishop.?pair|knight.?vs|material|forcing|threat|counterplay|manoeuvr|maneuver)\b/i;

const DROP_RE =
  /\b(chapter|volume|page|pp?\.|isbn|z-?library|bookwalk|cf\.|versus|\bvs\b|annotated|excerpt|common line|related games|games and notes|grandmaster repertoire|how to reassess|dvoretsky|capablanca|alekhine|fischer|kasparov|karpov|silman|hellsten|avrukh|smirin|chernov|chernev)\b/i;

/** OCR / scan debris from bookwalk passages — never show in app tips. */
const OCR_CORRUPT_RE =
  /_gadS|_[A-Za-z]{3,}\b|£\d|Family Four\b|lDf[0-9a-z]|ti\)|:\s*Rx|\bfXe\b|\bgc[0-8]\b|\bBfl\b|satisfactory defence|attacking task is very simple/i;

export function isCorruptPackNote(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return true;
  if (OCR_CORRUPT_RE.test(t)) return true;
  // Move-number spam + eval glyphs left after failed strip
  if (/\b\d{1,3}\.\.\./.test(t) && /[±∓∞]/.test(t)) return true;
  // Truncated OCR quote debris
  if (/[''`]\s*The best defence was!?\s*$/i.test(t)) return true;
  return false;
}

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!parts) return text.trim() ? [text.trim()] : [];
  return parts.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function stripChrome(raw: string): string {
  let t = (raw || "").replace(/\r/g, "\n");
  if (!t.trim()) return "";

  t = t.replace(/\s*Common line:[\s\S]*$/i, "");
  // Drop a trailing "Cf. ..." citation clause only (not the whole note)
  t = t.replace(/\s*Cf\.\s*[^.!?]*[.!?]?/gi, " ");
  t = t.replace(
    new RegExp(`^#{1,3}\\s+(?:${SECTION_TITLES})\\s*`, "gim"),
    ""
  );
  t = t.replace(/^#{1,3}\s+[^\n]{1,48}$/gm, "");
  t = t.replace(/^#{1,3}\s+/gm, "");
  t = t.replace(/\*\*?/g, "");
  t = t.replace(/\bThemes?:\s*[^.!\n]+[.!]?\s*/gi, "");
  t = t.replace(/\bGames and notes\s*[-:]?\s*/gi, "");
  t = t.replace(/\bRelated games\s*[-:]?\s*/gi, "");
  t = t.replace(/\bExcerpts\s*[-:]?\s*/gi, "");
  t = t.replace(/\bPlans and ideas\b/gi, "");
  t = t.replace(/\bMove types and motifs\b/gi, "");
  t = t.replace(/^\s*[-•*]\s+/gm, "");

  // Player vs player citations (optional year / ECO)
  t = t.replace(
    /\b[A-Z][A-Za-z.'\-]+(?:\s+[A-Z][A-Za-z.'\-]+)*\s+vs\.?\s+[A-Z][A-Za-z.'\-]+(?:\s+[A-Z][A-Za-z.'\-]+)*(?:\s+\d{4})?(?:\s*\([^)]*\))?/g,
    " "
  );
  // Parenthetical ECO game tags
  t = t.replace(/\[[^\]]*bookwalk[^\]]*\]/gi, " ");
  t = t.replace(/\(\s*[A-E]\d{2}\s*\)/g, " ");

  // Move numbers and move sequences (keep lone squares like "d4" as structure talk)
  t = t.replace(
    new RegExp(
      String.raw`\b\d{1,3}\.+\s*(?:${SAN_OR_PAWN}\b[\s,;:]*)+`,
      "g"
    ),
    " "
  );
  t = t.replace(
    new RegExp(String.raw`(?:\b${SAN_OR_PAWN}\b[\s,;:]*){2,}`, "g"),
    " "
  );
  t = t.replace(new RegExp(String.raw`\b${SAN_TOKEN}\b`, "g"), " ");
  t = t.replace(/\b(?:White|Black)\s+(?:plays|played|to move)\b/gi, " ");

  t = t.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/^[,;:\-—]+\s*/, "").replace(/\s+[,;]+/g, ",");
  return t.trim();
}

function sentenceKeepScore(sentence: string): number {
  const s = sentence.trim();
  if (s.length < 28) return -1;
  // leftover move debris
  if ((s.match(new RegExp(SAN_TOKEN, "g")) || []).length >= 2) return -1;
  if (!CONCEPT_RE.test(s)) return -1;
  // Drop citation/book-heavy lines unless they still teach a concept clearly
  if (DROP_RE.test(s) && !/\b(plan|idea|structure|motif|tactic|principle)\b/i.test(s)) {
    return -1;
  }

  let score = 1;
  const hits = s.match(new RegExp(CONCEPT_RE.source, "gi"));
  if (hits) score += Math.min(4, hits.length);
  if (/\b(plan|idea|structure|motif|tactic|principle)\b/i.test(s)) score += 2;
  if (DROP_RE.test(s)) score -= 2;
  if (s.length > 220) score -= 1;
  return score;
}

function softTrim(text: string, softMax: number): string {
  if (text.length <= softMax) return text;
  const cut = text.slice(0, softMax);
  const sentenceEnd = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("! "),
    cut.lastIndexOf("? ")
  );
  if (sentenceEnd > softMax * 0.4) {
    return cut.slice(0, sentenceEnd + 1).trim();
  }
  const sp = cut.lastIndexOf(" ");
  const soft = (sp > softMax * 0.35 ? cut.slice(0, sp) : cut).trim();
  return soft.endsWith(".") || soft.endsWith("!") || soft.endsWith("?")
    ? soft
    : `${soft}…`;
}

/**
 * Summarize a pack excerpt into a coaching note for the position/key concept.
 * @param maxSentences Keep at most N concept sentences (default 2; use 1 for one claim).
 */
export function reformatCoachNote(
  raw: string,
  softMax: number = SOFT_MAX,
  maxSentences: number = 2
): string {
  if (isCorruptPackNote(raw)) return "";
  const cleaned = stripChrome(raw);
  if (!cleaned || isCorruptPackNote(cleaned)) return "";

  const ranked = splitSentences(cleaned)
    .map((s) => ({ s, score: sentenceKeepScore(s) }))
    .filter((x) => x.score > 0 && !isCorruptPackNote(x.s))
    .sort((a, b) => b.score - a.score || a.s.length - b.s.length);

  if (!ranked.length) return "";

  const keepN = Math.max(1, Math.min(3, maxSentences));
  const keep = new Set(ranked.slice(0, keepN).map((x) => x.s));
  const ordered = splitSentences(cleaned).filter((s) => keep.has(s));
  let out = ordered.join(" ").replace(/\s+/g, " ").trim();
  out = out.replace(/\s+([,;.!?])/g, "$1");
  if (isCorruptPackNote(out)) return "";
  const minLen = keepN <= 1 ? 28 : 40;
  if (out.length < minLen) return "";
  return softTrim(out, softMax);
}

/** One didactic claim — single sentence from pack note. */
export function reformatCoachNoteOneClaim(
  raw: string,
  softMax: number = SOFT_MAX
): string {
  return reformatCoachNote(raw, softMax, 1);
}

/**
 * Light cleanup (legacy name). Prefer reformatCoachNote for UI notes.
 */
export function cleanBookProse(raw: string, softMax: number = SOFT_MAX): string {
  return reformatCoachNote(raw, softMax);
}

/** @deprecated Use reformatCoachNote */
export function polishDerivedConceptText(
  raw: string,
  _opts?: { themes?: string[]; maxSentences?: number }
): string {
  return reformatCoachNote(raw);
}
