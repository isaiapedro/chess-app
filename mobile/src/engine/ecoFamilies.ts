export type EcoFamily = {
  key: string;
  name: string;
  volume: "A" | "B" | "C" | "D" | "E";
  ecoLabel: string;
};

type EcoRange = {
  start: string;
  end: string;
  family: EcoFamily;
};

function ecoNum(code: string): number | null {
  const m = /^([A-E])(\d{2})$/i.exec(code.trim());
  if (!m) return null;
  const letter = m[1].toUpperCase().charCodeAt(0) - "A".charCodeAt(0);
  return letter * 100 + Number(m[2]);
}

function family(
  key: string,
  name: string,
  volume: EcoFamily["volume"],
  ecoLabel: string
): EcoFamily {
  return { key, name, volume, ecoLabel };
}

const RANGES: EcoRange[] = [
  {
    start: "A00",
    end: "A01",
    family: family("a-irregular", "Irregular Openings", "A", "A00–A01"),
  },
  {
    start: "A02",
    end: "A03",
    family: family("a-bird", "Bird's Opening", "A", "A02–A03"),
  },
  {
    start: "A04",
    end: "A09",
    family: family("a-reti", "Réti Opening", "A", "A04–A09"),
  },
  {
    start: "A10",
    end: "A39",
    family: family("a-english", "English Opening", "A", "A10–A39"),
  },
  {
    start: "A45",
    end: "A48",
    family: family("a-anti-indian", "Anti-Indian Systems", "A", "A45–A48"),
  },
  {
    start: "A53",
    end: "A55",
    family: family("a-old-indian", "Old Indian Defence", "A", "A53–A55"),
  },
  {
    start: "A56",
    end: "A56",
    family: family("a-benoni", "Benoni Defence", "A", "A56, A60–A79"),
  },
  {
    start: "A57",
    end: "A59",
    family: family("a-benko", "Benko Gambit", "A", "A57–A59"),
  },
  {
    start: "A60",
    end: "A79",
    family: family("a-benoni", "Benoni Defence", "A", "A56, A60–A79"),
  },
  {
    start: "A80",
    end: "A99",
    family: family("a-dutch", "Dutch Defence", "A", "A80–A99"),
  },
  {
    start: "B01",
    end: "B01",
    family: family("b-scandinavian", "Scandinavian Defence", "B", "B01"),
  },
  {
    start: "B02",
    end: "B05",
    family: family("b-alekhine", "Alekhine's Defence", "B", "B02–B05"),
  },
  {
    start: "B06",
    end: "B06",
    family: family("b-modern", "Modern Defence", "B", "B06"),
  },
  {
    start: "B07",
    end: "B09",
    family: family("b-pirc", "Pirc Defence", "B", "B07–B09"),
  },
  {
    start: "B10",
    end: "B19",
    family: family("b-caro-kann", "Caro-Kann Defence", "B", "B10–B19"),
  },
  {
    start: "B20",
    end: "B99",
    family: family("b-sicilian", "Sicilian Defence", "B", "B20–B99"),
  },
  {
    start: "C00",
    end: "C19",
    family: family("c-french", "French Defence", "C", "C00–C19"),
  },
  {
    start: "C20",
    end: "C20",
    family: family(
      "c-kp-unusual",
      "King's Pawn Opening (Unusual/Rare Lines)",
      "C",
      "C20, C44"
    ),
  },
  {
    start: "C21",
    end: "C22",
    family: family("c-centre", "Centre Game", "C", "C21–C22"),
  },
  {
    start: "C25",
    end: "C29",
    family: family("c-vienna", "Vienna Game", "C", "C25–C29"),
  },
  {
    start: "C30",
    end: "C39",
    family: family("c-kings-gambit", "King's Gambit", "C", "C30–C39"),
  },
  {
    start: "C41",
    end: "C41",
    family: family("c-philidor", "Philidor Defence", "C", "C41"),
  },
  {
    start: "C42",
    end: "C43",
    family: family("c-petrov", "Petrov's Defence", "C", "C42–C43"),
  },
  {
    start: "C44",
    end: "C44",
    family: family(
      "c-kp-unusual",
      "King's Pawn Opening (Unusual/Rare Lines)",
      "C",
      "C20, C44"
    ),
  },
  {
    start: "C45",
    end: "C45",
    family: family("c-scotch", "Scotch Game", "C", "C45"),
  },
  {
    start: "C47",
    end: "C49",
    family: family("c-four-knights", "Four Knights Game", "C", "C47–C49"),
  },
  {
    start: "C50",
    end: "C59",
    family: family("c-italian", "Italian Game", "C", "C50–C59"),
  },
  {
    start: "C60",
    end: "C99",
    family: family("c-ruy-lopez", "Ruy Lopez", "C", "C60–C99"),
  },
  {
    start: "D00",
    end: "D05",
    family: family("d-qp", "Queen's Pawn Game", "D", "D00–D05"),
  },
  {
    start: "D08",
    end: "D09",
    family: family("d-albin", "Albin Countergambit", "D", "D08–D09"),
  },
  {
    start: "D10",
    end: "D19",
    family: family("d-slav", "Slav Defence", "D", "D10–D19"),
  },
  {
    start: "D20",
    end: "D29",
    family: family("d-qga", "Queen's Gambit Accepted", "D", "D20–D29"),
  },
  {
    start: "D30",
    end: "D69",
    family: family("d-qgd", "Queen's Gambit Declined", "D", "D30–D69"),
  },
  {
    start: "D70",
    end: "D99",
    family: family("d-grunfeld", "Grünfeld Defence", "D", "D70–D99"),
  },
  {
    start: "E00",
    end: "E09",
    family: family("e-catalan", "Catalan Opening", "E", "E00–E09"),
  },
  {
    start: "E11",
    end: "E11",
    family: family("e-bogo", "Bogo-Indian Defence", "E", "E11"),
  },
  {
    start: "E12",
    end: "E19",
    family: family("e-queens-indian", "Queen's Indian Defence", "E", "E12–E19"),
  },
  {
    start: "E20",
    end: "E59",
    family: family("e-nimzo", "Nimzo-Indian Defence", "E", "E20–E59"),
  },
  {
    start: "E60",
    end: "E99",
    family: family("e-kings-indian", "King's Indian Defence", "E", "E60–E99"),
  },
];

const VOLUME_FALLBACK: Record<"A" | "B" | "C" | "D" | "E", EcoFamily> = {
  A: family("a-other", "Flank Openings", "A", "A00–A99"),
  B: family("b-other", "Semi-Open Games", "B", "B00–B99"),
  C: family("c-other", "Open Games", "C", "C00–C99"),
  D: family("d-other", "Closed Games", "D", "D00–D99"),
  E: family("e-other", "Indian Defences", "E", "E00–E99"),
};

function codeInRange(code: string, start: string, end: string): boolean {
  const n = ecoNum(code);
  const a = ecoNum(start);
  const b = ecoNum(end);
  if (n == null || a == null || b == null) return false;
  return n >= a && n <= b;
}

const FAMILIES_BY_NAME = new Map(
  RANGES.map((range) => [
    normalizeOpeningText(range.family.name),
    range.family,
  ] as const)
);

function normalizeOpeningText(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/defence/g, "defense")
    .replace(/[’']/g, "'");
}

export function resolveEcoFamily(
  eco?: string | null,
  _openingName?: string | null
): EcoFamily | null {
  const code = String(eco || "").toUpperCase().trim();
  if (!code || code === "UNK") return null;

  for (const range of RANGES) {
    if (codeInRange(code, range.start, range.end)) {
      return range.family;
    }
  }

  const letter = code[0] as "A" | "B" | "C" | "D" | "E";
  if (VOLUME_FALLBACK[letter]) return VOLUME_FALLBACK[letter];
  return null;
}

export function resolveFamilyByName(name?: string | null): EcoFamily | null {
  const key = normalizeOpeningText(String(name || ""));
  if (!key) return null;
  return FAMILIES_BY_NAME.get(key) || null;
}

export function familyMatchesSelection(
  selected: { key: string; eco?: string; name?: string },
  eco?: string | null,
  openingName?: string | null
): boolean {
  const gameFamily = resolveEcoFamily(eco, openingName);
  if (gameFamily && gameFamily.key === selected.key) return true;

  const selectedByName = resolveFamilyByName(selected.name);
  if (selectedByName && gameFamily && selectedByName.key === gameFamily.key) {
    return true;
  }

  const selectedFamily = resolveEcoFamily(selected.eco, selected.name);
  if (selectedFamily && gameFamily && selectedFamily.key === gameFamily.key) {
    return true;
  }

  const selectedEco = String(selected.eco || "").toUpperCase();
  const gameEco = String(eco || "").toUpperCase();
  if (selectedEco && selectedEco !== "UNK" && selectedEco === gameEco) {
    return true;
  }

  const selectedName = normalizeOpeningText(String(selected.name || ""));
  const gameName = normalizeOpeningText(String(openingName || ""));
  if (
    selectedName &&
    gameName &&
    (gameName === selectedName ||
      gameName.includes(selectedName) ||
      selectedName.includes(gameName))
  ) {
    return true;
  }
  return false;
}
