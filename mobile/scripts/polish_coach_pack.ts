import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  isTruncatedPackLine,
  polishCoachProse,
  polishPackField,
} from "../src/engine/gameCoach/coachProse.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packPath = path.join(__dirname, "../assets/coach/mobile_coach_pack.json");

type SlotMap = {
  worked?: string;
  attention?: string;
  lesson?: string;
  plan?: string;
};

function polishLine(raw: string): string {
  return polishCoachProse(raw).replace(/[.!?]+$/g, "").trim();
}

function polishNote(note: {
  text?: string;
  compact?: string;
  principle?: string;
  slots?: SlotMap;
}): void {
  if (typeof note.text === "string") {
    note.text = polishPackField(note.text) || polishLine(note.text);
  }
  if (typeof note.principle === "string") {
    note.principle = polishLine(note.principle);
  }
  if (note.slots) {
    for (const key of ["worked", "attention", "lesson", "plan"] as const) {
      const cur = note.slots[key];
      if (typeof cur === "string" && cur.trim()) {
        note.slots[key] = polishLine(cur);
      }
    }
  }
  const full =
    polishPackField(note.slots?.attention || "") ||
    polishPackField(note.text || "") ||
    "";
  if (typeof note.compact === "string") {
    let compact = polishPackField(note.compact);
    if (!compact || isTruncatedPackLine(compact) || isTruncatedPackLine(note.compact)) {
      compact = full;
    }
    note.compact = compact;
  }
}

function remainingIssues(hay: string): string[] {
  const hits: string[] = [];
  if (/predicament/i.test(hay)) hits.push("predicament");
  if (/utilize/i.test(hay)) hits.push("utilize");
  if (/^\s*[-•*]/.test(hay) || /\n[-•*]\s/.test(hay)) hits.push("bullet");
  if (/;/.test(hay)) hits.push("semicolon");
  if (/\s[—–]\s/.test(hay)) hits.push("emdash");
  if (/…/.test(hay)) hits.push("ellipsis");
  if (/\b(against|while|with|from|the|a|an|or|and|through|into|of)\.\s*$/i.test(hay)) {
    hits.push("dangling");
  }
  if (/use the move to create a concrete threat/i.test(hay)) hits.push("filler");
  if (/\bto connecting\b/i.test(hay)) hits.push("to-connecting");
  if (/\bthe the\b/i.test(hay)) hits.push("the-the");
  return hits;
}

const pack = JSON.parse(fs.readFileSync(packPath, "utf8")) as {
  entries?: Array<{
    text?: string;
    notes?: Array<{
      text?: string;
      compact?: string;
      principle?: string;
      slots?: SlotMap;
    }>;
  }>;
};

for (const entry of pack.entries || []) {
  if (typeof entry.text === "string") {
    entry.text = polishPackField(entry.text) || polishLine(entry.text);
  }
  if (typeof (entry as { compactDefinition?: string }).compactDefinition === "string") {
    (entry as { compactDefinition?: string }).compactDefinition = polishPackField(
      (entry as { compactDefinition: string }).compactDefinition
    );
  }
  for (const note of entry.notes || []) polishNote(note);
}

fs.writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`);

const after = fs.readFileSync(packPath, "utf8");
const issueCounts: Record<string, number> = {};
for (const entry of pack.entries || []) {
  const blobs = [entry.text, (entry as { compactDefinition?: string }).compactDefinition, ...(entry.notes || []).flatMap((n) => [
    n.text,
    n.compact,
    n.principle,
    n.slots?.worked,
    n.slots?.attention,
    n.slots?.lesson,
    n.slots?.plan,
  ])];
  for (const blob of blobs) {
    if (!blob) continue;
    for (const hit of remainingIssues(blob)) {
      issueCounts[hit] = (issueCounts[hit] || 0) + 1;
    }
  }
}

console.log("polish_coach_pack: wrote", packPath);
console.log("second-pass leftover counts:", issueCounts);
