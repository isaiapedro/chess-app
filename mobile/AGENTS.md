# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Game coach knowledge (derived pack only)

- **App never loads PDFs or the masters game database.**
- Offline CLI (`workspace/experiments/chess-coach`) does heavy lifting:
  1. `ingest` PDFs → Chroma
  2. `summarize-knowledge` → teaching summaries + ECO/motif tags
  3. `summarize-by-key` → soft-key buckets + key summaries
  4. GPT book notes live in `canon_key_notes.py` + compact index in `canon_key_meta.py`
  5. `summarize-key-ideas` / `export-mobile-pack` ship GPT notes + optional bookwalk passages
- Mobile loads [`assets/coach/mobile_coach_pack.json`](assets/coach/mobile_coach_pack.json) — soft-key tips used as teaching text only.
- Coach analysis cache key: `game-coach:v127`.
- **Situation profiles** (`situationProfiles.ts`): Tier-1 + Tier-2 + **Tier-3** (`pawn_storm`, `knight_vs_bishop`, `good_vs_bad_bishop`). Soft keys + `situationLock` (~11–14) below why_better (~28). **Side roles** (`binder`/`cramped`, `iqp_owner`/`blockader`, minority attacker/defender) reorder soft keys; stamped on `situations` / `situation_roles`. **Sticky**: `mergeStickySituations` — live overwrites same id; prior ids keep; never wipe to empty once seen.
- **Tier-3 snaps** (`tier3Metrics.ts`): `knight_vs_bishop` (−1/0/1), `good_vs_bad_bishop` (−1/0/1), `pawn_storm_tempo` (static race + `PawnStormTracker` window). EG rook endings: Lucena/Philidor/Vancura shape → primary soft key.
- **Quiet durable structure**: **off** (`allowPhaseStructure: false`) — no invented tips from windowed themes alone. Notes only on fixed checkpoints, live structural, bad/praise marks.
- **Game plan sticky keys** (`gamePlanState.ts`): `advanceGamePlan` every user ply (situations + windowed structure themes). `gamePlanLock` ~10–14. Demote sticky keys after **3** cold user plies (`GAME_PLAN_COLD_DEMOTE_PLIES`). Mistakes lead with tactical/why_better, then relate pack lesson to sticky plan when it fits. Moment inputs stamp `game_plan`.
- **Tactical frame** (`tacticalFact.ts`): bad_move tips lead with board-true fact (`missed_capture` / `gave_piece` / mate / …) via `tacticalLock` (~26); pack lesson follows. Soft keys prepend methodology/motif keys.
- Metric tips always **preferDidactic** (never fall back to bookwalk; metric template if no didactic note). OCR/corrupt pack text is rejected.
- Brilliant: sac offer ≥2, not already winning (WP before < 0.85), after WP ≥ 0.2; if lost before (WP < 0.25) must salvage to equal+ (WP ≥ 0.45). Praise marks always get a coach tip (bypass phase note cap).
- **Moment tip polish** (`momentJudgmentTip.ts`): MG/EG/bad/praise tips weave like opening dialogue — situations + plan + top metric before→after + tactical/engine line story + stripped pack clause. No cp dumps, "Why better:", or raw Δ lists.
- **Middlegame peer weave** (`middlegameCoachInputs.ts` + `middlegameJudgmentTip.ts`): `middlegame_aggregate` stamps full `MiddlegameGameRow` + BaselineStore peer Δ (same rating×speed cells as Insights); tip = praise+nudge like opening. Live MG moments get significant peer gaps too.
- **Middlegame attack/coordination snaps** (`middlegameAttackSnaps.ts` → `BoardMetricSnap`): opp king centre/uncastled, attack ratio / setup, opp shield holes, second weakness, queen centralization, connected rooks, liberation, side clamp, key squares, piece support. Soft keys via `METRIC_FIELD_TO_KEYS` (incl. orphan `positional.two_weaknesses`). No Lichess peer means yet — threshold / Δ until baseline rebuild.
- **MG strategic vectors** (`middlegameStructure.ts` + `middlegameStrategicTip.ts`): skeleton (`benoni_asymmetric`, Maróczy, …) + wing priorities + `pawn_break_class` + four vectors → `strategic_summary` tip lead. Opening.* plan/principles suppressed in MG.
- **EG technique context** (`endgameContext.ts` + `endgameStrategicTip.ts`): `endgame_type`, theoretical shape (LPV), `conversion_state`, technique vectors + `technical_rule` tip lead on `endgame_advantage` / EG live moments. No EG peer weave yet.
- Engine vs played line compare: horizon **8** plies; `diffMetricSnaps` emits every `BoardMetricSnap` field. **Skip** when played move is already best (no why_better / vs-played noise).
- Annotate script SF = Games analysis: first pass `COACH_ANALYZE_DEPTH` 18 / `COACH_ANALYZE_MOVETIME` 1000 / `COACH_ANALYZE_MULTIPV` 2; **every metric coach call** (fixed checkpoints, praise, live structural, mistake|missed|blunder) deepens `COACH_CRITICAL_*` (engine PV + line metrics). After deepen: **reclassify** mark + rewrite eval cps (mistakes + praise); still upsert live bad-move / praise moment when mark holds. Annotate noteCalc also mirrors tip loop: windowed structure + `PawnStormTracker`, `advanceGamePlan`, `gamePlan` into `rankMetricNoteWeights`, stamps `situations` / tactical / `game_plan`.
- Opening peer stamps need **numeric** rating + speed (or TimeControl→speed). Same bundled `opening_mix_lichess_v1.json` as Insights.
- **Games analyze pipeline:** (1) recalculate heuristics + every-ply SF + style/eval buckets + bundled peer baselines; (2) stamp mistake line metrics (`engineLine` / `playedLine` / `engineVsPlayed`); (3) only then soft keys → pack tips → summary. No separate before→after metric-diff coaching step. Coach heuristics replace that game in the Metrics heuristics store; UI remeshes (no force re-analyze).
- `material_balance` = own−opp with p=1, n/b=3, r=5, q=9 (pawns included).
- Engine/played line: if leaf `hanging_material_own` or `hanging_material_opponent` ≠ 0, take **+1 ply** for the metric snap.
- Line compare = **best PV** vs **played move + engine continuation** (not the real game — opponent later errors do not pollute Δ).
- Opponent WP gifts: track pending chance for **missed** marks only — never inject `opponent_mistake` coach moments or tips (opp ply or reply).
- GPT tips: impersonal directive lists (pack v10+); soft-key id = metric lookup. Opening prose = `formatOpeningLabel` name, never raw ECO.
- **themesByPhase / globalThemes = soft-key metric ids** (`metricThemes.ts`), not free labels like `pawn_breaks`.
- Deterministic engine-line explain (`engineLineExplain.ts`): metric Δ → why-better + soft keys; opening principles when applicable.
- **why_better is primary** for bad-move tips when no tactical fact: soft-key weights boost `primarySoftKeys`; unrelated `attack.king_safety` is downranked unless attackers Δ favors the engine. Tip prose = `composeMomentJudgmentTip` (situations / plan / metric before→after / engine line / stripped lesson) — not raw why_better dumps. When `detectTacticalFact` fires, fact + line story lead the weave.
- `metric_signals` / `primary_field` / `primary_metric_keys` / `peer_signals` stamped on moment inputs (cache **v101**).
- Critical coach moments = mistake/blunder only (not inaccuracy). Fixed schedule tips **keep** `fixed_checkpoint` even when a critical mark lands on the same ply (`critical_mark` still stamped).
- Inaccuracy stays a move mark/GIF only — never `bad_move` note request, never live moment, never tip attach.

### Rigid coach-moment schedule
| Moment | When |
|--------|------|
| `opening_name` | User ply of **fullmove 5** |
| `opening_aggregate` | User ply of **fullmove 10** — concepts/structure by default; engine line only if eval gap ≥ inaccuracy |
| `middlegame_aggregate` | User ply at `endgame_start` |
| `endgame_advantage` | User ply at `endgame_advantage_start` |
| `decisive_pawn_break` | Live MG pawn break: 8-ply engine follow-up vs **pre-break** structure Δ; vs best line if a better move existed; soft keys from structure + situations |
| Bad / praise marks | Flexible only (`bad_move` / `praise_move`); opp gifts do **not** create structural moments |

Quiet opening spam is **off** (`openingAlwaysAttach: false`). Quiet durable structure tips are **off** (`allowPhaseStructure: false`) — coach comments only from metric coach calls (fixed checkpoints, live structural, bad/praise). Always-attach kinds (`requestAlwaysAttaches`) **bypass** per-phase note caps so praise/bad/structural/fixed tips always reach `ply.note`.

### Opening checkpoint inputs + soft keys
- Moments get an **opening metric snapshot** (`minors_developed`, `castle_fullmove`, `uncastled`, `center_control_pct`, `tempo_waste_rate_pct`, `space_advantage_pct`, …) via `openingCoachInputs.ts` — not only line Δ.
- **Peer comparison** (`peer_*` / `peer_delta_*`) from bundled baselines (`lookupBaseline`, rating×speed cell — same as Insights). Missing band/speed → skip peers, keep snapshot. Irregular ECO has no ECO-scoped peers.
- **Peer polarity** (Insights `metricPolarity`): `castle_fullmove` / `uncastled_rate` / `tempo_waste` = **lower better**; minors / centre / accuracy / space = **higher better**. `peer_signals` = `{metric, Δ, polarity, judgment}` with impact flipped so positive = good for the user.
- Soft keys for opening moments: **only** significant peer/snapshot judgments → metric keys (+ one `openingKeyId` when named). No principle laundry list (`pawn_break` / `candidate_moves` / prophylaxis fillers). Zero line Δ does not add keys.
- Opening tip text: weave significant peer **good** + **bad** into one natural phrase (praise, then “just remember…” nudge). Prefer short pack clauses per softKey when rich enough; else curated templates. No raw numbers / peer Δ / SAN / book titles.
- Tip text: **one praise + one nudge**; prefer softKeys not used earlier; exact-clause dedupe only. Named-opening plan only (no Irregular principle bolt-on).
- Tip stamps up to **3** `key_ids` on moment inputs (`key_id` primary + `key_ids` csv).
- Opening plans: pack plan only when a named `openingKeyId` resolves (not Irregular).
- Zone advances stay on snaps/diffs; tip topic threshold ≥4 so early checkpoints can use them if later Δ never grows.
- Open/semi-open file utilization: snap + MG/EG accumulator; soft keys `piece.coordination` / `imbalance.space` (not seventh-rank).
- Bishop snaps (per light/dark, own+opp): `bishop_diagonal_influence_*` (squares overseen on rays) and `bishop_openness_*` (empty diagonal squares). Phase `unblocking_bishop_*` = peak openness (not event counts). Soft keys: `positional.color_complexes`, bishop-pair / good-vs-bad.

### Note selection (metrics → didactic key)
- [`metricNoteKeys.ts`](src/engine/gameCoach/metricNoteKeys.ts) maps metric fields / moment inputs → soft keys (`softKeysForNoteRequest`).
- [`metricNotes.ts`](src/engine/gameCoach/metricNotes.ts): pool pack entries **only** from those keys; prefer mid-specificity didactic notes.
- **Many soft keys per game OK.** Non-repetition only (`noteId` / text fingerprint) — no 1-key-per-game lock.
- No vault-candidate moments. No FEN/SAN matching. No theme-catalog browse for tip pick.

### Finale
- [`gameSummary.ts`](src/engine/gameCoach/gameSummary.ts): **Early game / Middlegame / Late game** (metrics + checkpoints).

### Smoke
```bash
cd mobile && npx --yes tsx scripts/test-coach-moments.mjs
node scripts/test-adapt-note-squares.mjs
node scripts/test-coach-marks.mjs
npx --yes tsx scripts/test-phase-tactical-metrics.mjs
- Dump coach-call inputs + generated tips from annotate JSON (shows situations / tactical / game_plan / weight locks):
npx --yes tsx scripts/dump_coach_moments.mjs ../samples/metrics_all.json
npx --yes tsx scripts/dump_coach_moments.mjs ../samples/metrics_all.json --json
```

### Re-ingest (metric keys + opening general plans)
```bash
cd workspace/experiments/chess-coach
# Optional LLM rewrite (needs API key): opening.* = GENERAL PLANS only; metric keys didactic
chess-coach summarize-key-ideas
# or scoped: chess-coach summarize-key-ideas --keys opening.sicilian,positional.pawn_break,attack.king_safety
chess-coach export-mobile-pack
# Without LLM: chess-coach summarize-key-ideas --no-llm && chess-coach export-mobile-pack
```
Copy exported pack to `mobile/assets/coach/mobile_coach_pack.json`.

### Coach-only metrics
`pawn_break`, `defended_pawn`, `unblocking_bishop_{light,dark}`, `checks` (+pins), `blocking_checks`, phase `pawn_moves`, `king_attackers` (own+opp), MG/EG `seventh_rank_infiltration` (R+Q; phase accumulator + position snap of R/Q on 7th/2nd), MG/EG `open_file_utilization` (R+Q on open/semi-open; phase accumulator + position snap), EG `opposition`, zone pawn advances `queenside_advance` / `kingside_advance` / `center_advance` (+ `_opponent`). Hanging on snaps is material-value only: `hanging_material_own` / `hanging_material_opponent` (no piece-count fields).
