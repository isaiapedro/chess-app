/**
 * Light format cleanup for soft-key book cards.
 * Keeps teaching prose; strips markdown / export chrome only.
 */

const SOFT_MAX = 480;

const SECTION_TITLES =
  "Plans and ideas|Structures|Move types and motifs|Conditional positions|" +
  "Openings|Games and notes|Related games|Excerpts|Plans|Ideas";

/**
 * Strip headers, Themes dumps, bullets, Common-line chrome.
 * Keep book-like sentences; soft-trim at a sentence boundary if over SOFT_MAX.
 */
export function cleanBookProse(raw: string, softMax: number = SOFT_MAX): string {
  let t = (raw || "").replace(/\r/g, "\n");
  if (!t.trim()) return "";

  t = t.replace(/\s*Common line:[\s\S]*$/i, "");
  t = t.replace(/\s*Cf\.[\s\S]*$/i, "");

  // Drop known section headers but keep following prose on same line
  t = t.replace(
    new RegExp(`^#{1,3}\\s+(?:${SECTION_TITLES})\\s*`, "gim"),
    ""
  );
  // Short title-only lines (# Isolated Queen's Pawn)
  t = t.replace(/^#{1,3}\s+[^\n]{1,48}$/gm, "");
  // Any leftover hash markers
  t = t.replace(/^#{1,3}\s+/gm, "");
  t = t.replace(/\*\*?/g, "");

  // Drop meta dumps (keep sentences before/after)
  t = t.replace(/\bThemes?:\s*[^.!\n]+[.!]?\s*/gi, "");
  t = t.replace(/\bGames and notes\s*[-:]?\s*/gi, "");
  t = t.replace(/\bRelated games\s*[-:]?\s*/gi, "");
  t = t.replace(/\bExcerpts\s*[-:]?\s*/gi, "");

  // Bullets → prose
  t = t.replace(/^\s*[-•*]\s+/gm, "");
  t = t.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();

  // If almost only game citations remain, drop
  const citeHeavy =
    (t.match(/\bvs\b/gi) || []).length >= 2 &&
    t.length < 160 &&
    !/\b(pawn|attack|plan|structure|bishop|king|file|break)\b/i.test(t);
  if (citeHeavy) return "";

  if (!t) return "";
  if (t.length <= softMax) return t;

  const cut = t.slice(0, softMax);
  const sentenceEnd = Math.max(
    cut.lastIndexOf(". "),
    cut.lastIndexOf("! "),
    cut.lastIndexOf("? ")
  );
  if (sentenceEnd > softMax * 0.45) {
    return cut.slice(0, sentenceEnd + 1).trim();
  }
  const sp = cut.lastIndexOf(" ");
  const soft = (sp > softMax * 0.4 ? cut.slice(0, sp) : cut).trim();
  return soft.endsWith(".") || soft.endsWith("!") || soft.endsWith("?")
    ? soft
    : `${soft}…`;
}

/** @deprecated Use cleanBookProse — kept for any stray imports */
export function polishDerivedConceptText(
  raw: string,
  _opts?: { themes?: string[]; maxSentences?: number }
): string {
  return cleanBookProse(raw);
}
