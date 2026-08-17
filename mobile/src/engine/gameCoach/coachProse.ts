const FILLER_LINE =
  /use the move to create a concrete threat the opponent must answer/i;

const POMPOUS: Array<[RegExp, string]> = [
  [/\bpredicament\b/gi, "position"],
  [/\butilize\b/gi, "use"],
  [/\bcommence\b/gi, "start"],
  [/\bprior to\b/gi, "before"],
  [/\bsubsequently\b/gi, "then"],
  [/\bnevertheless\b/gi, "still"],
  [/\bfurthermore\b/gi, "also"],
  [/\bmonarch\b/gi, "king"],
  [/\bendeavo(?:u)?r\b/gi, "try"],
  [/\bascertain\b/gi, "check"],
  [/\bfacilitate\b/gi, "help"],
  [/\baforementioned\b/gi, ""],
  [/\bin order to\b/gi, "to"],
  [/\bthe fact that\b/gi, "that"],
  [/\bit is important to\b/gi, ""],
  [/\bit is crucial to\b/gi, ""],
  [/\bone must\b/gi, "you"],
  [/\bthe student should\b/gi, "you"],
  [/\bbefore launching an attack\b/gi, "before you attack"],
  [/\bbefore launching\b/gi, "before you start"],
  [/\bfavou?rs? the engine line\b/gi, "explains the better move"],
  [/\bthe engine line\b/gi, "the better move"],
  [/\bthe correct predicament answer\b/gi, "the better move"],
  [/\ba concrete threat\b/gi, "a threat"],
  [/\bimmediate entry squares\b/gi, "entry squares"],
];

function capSentence(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function repairMalformed(t: string): string {
  let s = t;
  s = s.replace(/\bto to\b/gi, "to");
  s = s.replace(/\bthe the\b/gi, "the");
  s = s.replace(/\bis is\b/gi, "is");
  s = s.replace(/\bto connecting\b/gi, "to connect");
  s = s.replace(/\bto developing\b/gi, "to develop");
  s = s.replace(/\bto finishing\b/gi, "to finish");
  s = s.replace(/\bto keeping\b/gi, "to keep");
  s = s.replace(/\bto meeting\b/gi, "to meet");
  s = s.replace(/\bto claiming\b/gi, "to claim");
  s = s.replace(/\bto looking\b/gi, "to look");
  s = s.replace(/\bto bringing\b/gi, "to bring");
  s = s.replace(/\bto using\b/gi, "to use");
  s = s.replace(/\bto opening\b/gi, "to open");
  s = s.replace(/\bBetter is to to\b/g, "Better is to");
  s = s.replace(/\bthe idea is the idea\b/gi, "the idea is");
  s = s.replace(/\bBetter is Better is\b/g, "Better is");
  s = s.replace(/\s+,/g, ",");
  s = s.replace(/,\s*,/g, ",");
  s = s.replace(/\.\s*\./g, ".");
  s = s.replace(/\s{2,}/g, " ");
  return s.trim();
}

export function isTruncatedPackLine(raw: string): boolean {
  const t = String(raw || "")
    .replace(/^[-•*]\s*/, "")
    .trim();
  if (!t) return false;
  if (/…/.test(t)) return true;
  if (/\.\.\.\s*$/.test(t) && !/\d+\.\.\.\s*$/.test(t)) return true;
  if (/\b(against|while|with|from|the|a|an|or|and|through|into|of|to)\.\s*$/i.test(t)) {
    return true;
  }
  return false;
}

export function polishPackField(raw: string): string {
  const lines = String(raw || "")
    .split(/\n+/)
    .map((line) => line.replace(/^[-•*]\s*/, "").trim())
    .filter(
      (line) =>
        line && !FILLER_LINE.test(line) && !isTruncatedPackLine(line)
    )
    .map((line) => polishCoachProse(line).replace(/[.!?]+$/g, "").trim())
    .filter(Boolean);
  const kept: string[] = [];
  for (const line of lines) {
    const words = line.split(/\s+/).length;
    const slogan =
      words <= 5 &&
      !/\b(because|when|before|after|if|check|look|use|place|castle|attack|defend|develop|break)\b/i.test(
        line
      );
    if (slogan && lines.length >= 2) continue;
    kept.push(line);
  }
  const joined = bookJoin(kept.length ? kept : lines);
  if (joined && !isTruncatedPackLine(joined)) {
    return /[.!?]$/.test(joined) ? joined : `${joined}.`;
  }
  return "";
}

export function polishCoachProse(raw: string): string {
  let t = String(raw || "").replace(/\r/g, "\n").trim();
  if (!t) return "";
  t = t
    .split(/\n+/)
    .map((line) => line.replace(/^[-•*]\s*/, "").trim())
    .filter((line) => line && !FILLER_LINE.test(line))
    .join(" ");
  t = t.replace(/^Apply the lesson:\s*/i, "");
  t = t.replace(/\s*[—–]\s*/g, ". ");
  t = t.replace(/\s+--\s+/g, ". ");
  t = t.replace(/\s+-\s+/g, ". ");
  t = t.replace(/\s*;\s*/g, ". ");
  for (const [re, to] of POMPOUS) {
    t = t.replace(re, to);
  }
  t = t.replace(/\b(actually|really|basically|indeed)\b/gi, "");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/^\.\s*/, "");
  const parts = t
    .split(/(?<=[.!?])\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(capSentence);
  t = parts.join(" ");
  t = repairMalformed(t);
  return t.replace(/\s+/g, " ").trim();
}

export function bookJoin(parts: string[]): string {
  const bits = parts
    .map((p) => polishCoachProse(p).replace(/[.!?]+$/g, "").trim())
    .filter(Boolean);
  if (!bits.length) return "";
  return bits.map(capSentence).join(". ");
}
