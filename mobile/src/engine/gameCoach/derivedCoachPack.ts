/* Types for the bundled coach pack asset (assets/coach/mobile_coach_pack.json). */
/* Pack data is NOT inlined here — ships with the app binary; parsed on first analyze. */

export type DerivedFrequentLine = {
  sanLine: string;
  count: number;
  eco: string;
};

export type DerivedCoachNote = {
  id: string;
  text: string;
  book: string;
  themes: string[];
  ecoHints: string[];
  patterns?: string[];
  principle?: string;
  phase?: string;
  fens?: string[];
  sanLines?: string[];
  openings?: string[];
  games?: string[];
  specificity?: number;
  features?: string[];
  compact?: string;
  /** Tip-structure slots: wire directly to lead/core/remember/plan. */
  slots?: {
    worked?: string;
    attention?: string;
    lesson?: string;
    plan?: string;
  };
  /** Match notes to live metrics / situations / openings / polarity. */
  conditions?: Array<{
    softKey?: string;
    metric?: string;
    situation?: string;
    theme?: string;
    opening?: string;
    polarity?: "good" | "bad" | "any";
    feature?: string;
  }>;
};

export type DerivedCoachEntry = {
  id: string;
  text: string;
  book: string;
  chapter: string;
  themes: string[];
  motifs: string[];
  ecoHints: string[];
  frequentLines: DerivedFrequentLine[];
  notes?: DerivedCoachNote[];
  keyId?: string;
  keyType?: string;
  label?: string;
  games?: string[];
  books?: string[];
  sourceKind?: string;
  compactDefinition?: string;
  modelGame?: string;
};

export type DerivedCoachPack = {
  version: number;
  generatedBy: string;
  source?: string;
  entryCount: number;
  entries: DerivedCoachEntry[];
};
