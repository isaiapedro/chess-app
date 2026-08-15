/* Types for the bundled coach pack asset (assets/coach/mobile_coach_pack.json). */
/* Pack data is NOT inlined here — ships with the app binary; parsed on first analyze. */

export type DerivedFrequentLine = {
  sanLine: string;
  count: number;
  eco: string;
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
  keyId?: string;
  keyType?: string;
  label?: string;
  games?: string[];
  books?: string[];
  sourceKind?: string;
};

export type DerivedCoachPack = {
  version: number;
  generatedBy: string;
  source?: string;
  entryCount: number;
  entries: DerivedCoachEntry[];
};
