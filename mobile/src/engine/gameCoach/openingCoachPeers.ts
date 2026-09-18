/**
 * Load bundled peer baselines for opening coach enrichment (annotate / dump / analyze).
 * Avoids importing baselines.ts (pulls RN cache) so Node scripts stay clean.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OpeningPeerContext } from "./openingCoachInputs";

function loadBundledBaselineStore(): OpeningPeerContext["baselines"] {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(
      here,
      "../../../assets/baselines/opening_mix_lichess_v1.json"
    );
    if (!existsSync(path)) return null;
    const rows = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(rows)) return null;
    const by_cell: Record<
      string,
      Record<string, { mean: number | null }>
    > = {};
    for (const row of rows) {
      if (!row?.metric || !row?.rating_band || !row?.speed) continue;
      const cell = `${row.rating_band}|${row.speed}`;
      const bucket = by_cell[cell] || (by_cell[cell] = {});
      bucket[row.metric] = {
        mean:
          row.mean == null || !Number.isFinite(Number(row.mean))
            ? null
            : Number(row.mean),
      };
    }
    return { available: rows.length > 0, by_cell };
  } catch {
    return null;
  }
}

export function defaultBundledPeerContext(partial?: {
  rating?: number | null;
  speed?: string | null;
  timeControl?: string | null;
  baselines?: OpeningPeerContext["baselines"];
}): OpeningPeerContext {
  return {
    baselines: partial?.baselines ?? loadBundledBaselineStore(),
    rating: partial?.rating ?? null,
    speed: partial?.speed ?? null,
    timeControl: partial?.timeControl ?? null,
  };
}
