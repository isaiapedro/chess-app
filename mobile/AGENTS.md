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
- Mobile comments load [`assets/coach/notes_schema.json`](assets/coach/notes_schema.json) — fact-guarded templates only. [`assets/coach/mobile_coach_pack.json`](assets/coach/mobile_coach_pack.json) stays on disk unused by the comment path.
- Coach analysis cache key: `game-coach:v168`.
- **Comment pipeline** (3-stage, shared by analyze / dump / annotate via `attachCoachComment`):
  1. **Stage 1** [`coachEvent.ts`](src/engine/gameCoach/coachEvent.ts) `classifyMoment` — first match wins. Tier 1 `tactical_blunder` (`tacticalFact.kind` or mark `blunder`/`missed` or `dropCp >= 200`). Tier 2 `positional_error` (mark `mistake` or `dropCp >= 100`, no tactic). Tier 3 `fixed_checkpoint` (`opening_name` / `opening_aggregate` / `middlegame_aggregate` / `endgame_advantage` / `decisive_pawn_break`). Tier 4 `praise` (`brilliant` → `brilliant`; `excellent` → `great_find`). Mute: inaccuracy, important, quiet plies, opp gifts. A blunder on fullmove 10 is Tier 1 only — the opening aggregate does not also speak.
  2. **Stage 2** [`noteGuards.ts`](src/engine/gameCoach/noteGuards.ts) `selectNote` — filter `eventKinds` + every declared guard equals live FEN/metrics/tacticalFact (`user_castled` / `opp_castled` from king square + rights, same truth as `opp_king_uncastled`). Winner = most explicit guards, then stable `id` sort. No additive weights. Pack paragraphs are not comment prose.
  3. **Stage 3** [`commentComposer.ts`](src/engine/gameCoach/commentComposer.ts) interpolates `{piece}` `{square}` `{bestSan}` `{playedSan}` only. Missing token drops that sentence. Tier 1 + `dropCp >= 200`: `{attention} Best was {bestSan} ({lesson}).` Else `{attention} {plan}`.
- **Silence** [`coachSilence.ts`](src/engine/gameCoach/coachSilence.ts) `CoachSilenceManager` — two rules only: mute if `(ply - lastCommentPly) < 2` (speak 10, 12, 14…); mute if `keyId` or `note.id` already used this game. Bypass: `tactical_blunder && dropCp >= 300` **or** `praiseKind === 'brilliant'`. Excellent and checkpoints are **not** exempt. Checkpoints use distinct `keyId`s (`checkpoint.opening_name`, …) so move-5 does not eat move-10. Dump/annotate `--ignore-silence` (alias `--ignore-phase-limits`) skips silence for debug. No phase caps, no `acceptKeyNote`, no 8-ply `bestSan`/`keyId` windows.
- **Situation profiles** (`situationProfiles.ts`): Tier-1 + Tier-2 + **Tier-3** (`pawn_storm`, `knight_vs_bishop`, `good_vs_bad_bishop`). Soft keys + `situationLock` (~11–14) below why_better (~28). **Side roles** (`binder`/`cramped`, `iqp_owner`/`blockader`, minority attacker/defender) reorder soft keys; stamped on `situations` / `situation_roles`. **Sticky**: `mergeStickySituations` — live overwrites same id; prior ids keep except **IQP** (drops when live board has no isolani); never wipe to empty once seen. **IQP situation** only when windowed `structureThemes` includes `iqp` **and** the live FEN still has a d-isolani.
- **Structure persist** (`HEURISTICS_STRUCTURE_PERSIST_PLIES` = **4**): IQP / doubled / backward and windowed structure themes must hold **4 consecutive plies**. One-ply flicker is not a theme. Once a run confirms, **backdate to the birth ply** (`confirmedStructureThemesByPly` / `structurePersistStartPly1`) — notes, situations, and `had_iqp` events stamp the first move of the run, not only ply 4. `blockade_square_control` maps to `piece.blockade` only — not `structure.iqp`.
- **Tier-3 snaps** (`tier3Metrics.ts`): `knight_vs_bishop` (−1/0/1), `good_vs_bad_bishop` (−1/0/1), `pawn_storm_tempo` (static race + `PawnStormTracker` window). EG rook endings: Lucena/Philidor/Vancura shape → primary soft key.
- Quiet durable structure tips stay **off** — no invented tips from windowed themes alone. Comments only from Stage 1 events (fixed checkpoints, live pawn break, bad marks, brilliant, excellent).
- **Game plan sticky keys** (`gamePlanState.ts`): `advanceGamePlan` every user ply (situations + windowed structure themes). `gamePlanLock` ~10–14. Demote sticky keys after **3** cold user plies (`GAME_PLAN_COLD_DEMOTE_PLIES`). Mistakes lead with tactical/why_better, then relate pack lesson to sticky plan when it fits. Moment inputs stamp `game_plan`.
- **Tactical frame** (`tacticalFact.ts`): bad_move tips lead with board-true fact via `tacticalLock` (~26). **Priority cascade:** (1) self-inflicted — own piece newly 0 legal moves **and** a losing capture (attackers > defenders, cheapest attacker < piece; **king counts if the piece is undefended**), or trap that appears **after a reply** on the played continuation (`detectNewlyTrappedAlongSans` — e.g. king walk then 0 safe squares), or delayed capture of an already-boxed piece (`trapped_piece` + `selfInflicted`, or `gave_piece` hang) always beats (2) missed opportunity on the engine line (`missed_capture` / opp trap / mate / fork) which only fires when own pieces are safe, then (3) positional. Do not label “missed hanging bishop” when the played move trapped your own rook. Soft keys prepend methodology/motif keys. Sharpness stamp: first-pass MultiPV WP gap (`mergeMultiPvGapLines` keeps PV2 across `COACH_CRITICAL_MULTIPV=1` deepen, then re-ranks by STM score) + forcing ratio on best PV (`tactical_pv_gap_wp` / `tactical_forcing_ratio` / `tactical_sharp`). **Forcing = checks/mates only** — recaptures/`x` trades are not forcing. `tactical_sharp` = forcing-sharp, not MultiPV gap alone. `missed_tactic` = forcing-sharp **or** board motif on best SAN (pin → fork → hang). Quiet knight hop / equal-exchange PV with no motif is positional, not a tactic. `motif.intermediate_move` is not the default missed-tactic key (no zwischenzug). Motif stamps `tactical_motif`; pin/skewer → `motif.pin_and_skewer`. `tactical_self_inflicted` stamped when the crisis is own-piece. **Equal → mate-in-N is a live blunder** (`hung_mate`); do not drop it as “terminal eval noise”. Board-probe mate-in-2 (`forcedMate.ts`) when SF PV1 is drawish but the left position is forced mate (≤12 pieces); after-eval uses the same MultiPV as the first pass, not MultiPV 1.
- Metric notes in `notes_schema.json` always interpolate live tokens (never fall back to bookwalk or pack paragraphs). OCR/corrupt pack text is not comment input.
- Brilliant: sac offer ≥2, not already winning (WP before < 0.85), after WP ≥ 0.2; if lost before (WP < 0.25) must salvage to equal+ (WP ≥ 0.45). Drop must stay below inaccuracy (`WP_INACCURACY_DROP` 0.05) — **does not require PV1**. **Brilliant** and **excellent** notes always attach (`praise_move`). **important** is GIF-only — never a live coach moment or comment. Stamp important only for best + MultiPV gap that is not a simple hanging-piece / capture-threat retreat (no extra sac, check, capture, or counterthreat). **Excellent** GIF: strip recaptures, hanging/underprotected captures, checks, blocking checks, and opening minor development (N/B off home square, fullmove ≤ 10) — only surviving excellent marks get comments.
- **Fixed checkpoints**: Stage 3 templates keyed by `checkpoint.*` (distinct `keyId`s). Pack weavers (`phaseCheckpointTip.ts` / MG/EG judgment tips) do **not** write `ply.note`. **Eval-aware** (`evalSwingIndex.ts`): stamp `user_wp` / `eval_band` on every checkpoint. **Mistake/blunder on the same ply takes over** via Stage 1 (tier 1/2 beats the checkpoint event).
- **Live moment tip polish** (`tipAspectAssemble.ts` + `momentJudgmentTip.ts` + `coachProse.ts`): flexible good/bad/neutral aspects by tone for bad/praise/live structural — not the checkpoint rigid shape. **First phrase = dynamic verdict** (`toneVerdictLead`) asserting correct / incorrect / still-open plan. Book-style sentences (periods, no `;` / emdash glue, no predicament). Critique separates **played miss** from **correct answer** (`frameAsCorrectIdea` → `Better is …`) — engine-gap metrics / engine line / pack attention are never narrated as what happened in the game. **Engine comments = first follow-up SAN + idea** (`Nh5 to develop`, `Re4 to save the rook`) — never an unexplained PV dump. **Missed and thin mistakes** always name **that move vs played SAN**. **Self-inflicted hunt** (`trapped_piece` + `selfInflicted`, `gave_piece`, `hung_mate`): `captureSan` is the opponent continuation — diagnosis only; `voice:correct` is the engine PV, never Kh3-takes-your-rook.
- **Coordinate localization** (`tipCoordinate.ts` + `metricAxisRank.ts`): a comment is a **four-pillar cell**, not a winning weighted topic. Occupied pillars weave into one sentence — **plan** (opening/structure + role, sticky game plan, MG wing), **principleLine** (opening/MG/EG principles vs engine follow-up for mistakes), **value** (remaining metric vector; proxy `|Δ|` like `piece_support` stays downranked), **feature** (queen re-move, undeveloped minors, opp king in centre). Board facts stamp even with Δ=0. **Deep scan** (`scanPillarConditions` + `wideRankedAxes`): all live situations + aliases (`uncastled-king` ↔ `opp_king_uncastled`) feed a wide condition bag; pack notes score by pillar family (plan / principle / value / feature). Disjoint metric notes still drop (`WIDE_CONDITION_FLOOR`). `key_ids` from the coordinate, not the full soft-key dump.
- **Middlegame peer weave** (`middlegameCoachInputs.ts` + `middlegameJudgmentTip.ts`): `middlegame_aggregate` stamps full `MiddlegameGameRow` + BaselineStore peer Δ; tip = so-far / now / going-forward rigid weave. Live MG moments get significant peer gaps too.
- **Middlegame attack/coordination snaps** (`middlegameAttackSnaps.ts` → `BoardMetricSnap`): opp king centre/uncastled, attack ratio / setup, opp shield holes, second weakness, queen centralization, connected rooks, liberation, side clamp, key squares, piece support. Soft keys via `METRIC_FIELD_TO_KEYS` (incl. orphan `positional.two_weaknesses`). No Lichess peer means yet — threshold / Δ until baseline rebuild.
- **MG strategic vectors** (`middlegameStructure.ts` + `middlegameStrategicTip.ts`): skeleton (`benoni_asymmetric`, Maróczy, …) + wing **plan** + `pawn_break_class` + four vectors → human `strategic_summary` / `played_impact` (structure labels like “Dragon structure”, not `Plan: queenside (dragon_formation)`). Opening.* plan/principles suppressed in MG. **`active_wing_user` = recommended plan**, not zone-advance activity (`user_wing_activity` is the observed metric). Plan order: **engine-line pawn-push aggregate** (user pawn moves on the PV, scored by dest wing + advance depth; rook/piece moves ignored; horizon 8, same deepened line as pawn-break compare) → Dragon/Maróczy/hedgehog/Scheveningen **cramped** = queenside → closed centre + opp KS storm ≥4 = queenside → `preferCenterStrike` = center. **`prefer_center_strike` is a board flag only** (uncastled/central king + open centre, or opp KS ≥4); it must not override a queenside engine-line pawn plan or cramped-Dragon plan. `pawn_break_class` = played lever vs **recommended** wing (`e5` vs QS plan = `wrong_center_break`). `engine_line_plan` follows `active_wing_user`. `isOppositeSideCastling` requires both kings on c/g — e-file king is not opposite-side. `opp_king_in_centre` = d/e file (includes e8). Snaps: `center_fluidity_index` (0 locked … 100 open d/e), `pawn_storm_tempo_delta` (user QS − opp KS), `king_center_file_exposure` (open/semi d/e vs uncastled/central king).
- **EG technique context** (`endgameContext.ts` + `endgameJudgmentTip.ts` / `endgameStrategicTip.ts`): `endgame_advantage` checkpoint = so-far / now / from-here rigid weave from conversion + technique vectors. Live EG mistakes still use flexible moment/strategic tips.
- Engine vs played line compare: horizon **8** plies; `diffMetricSnaps` emits every `BoardMetricSnap` field. **Skip** when played move is already best (no why_better / vs-played noise).
- Annotate script SF = Games analysis: first pass `COACH_ANALYZE_DEPTH` 18 / `COACH_ANALYZE_MOVETIME` 1000 / `COACH_ANALYZE_MULTIPV` 2; **every metric coach call** (fixed checkpoints, praise brilliant/excellent, live structural, mistake|missed|blunder) deepens `COACH_CRITICAL_*` (engine PV + line metrics). First-pass PV2 survives deepen via `mergeMultiPvGapLines`. JSON dump includes `engine[].lines` (SAN + cp) so `dump_coach_moments` rebuilds sharpness/motif. After deepen: **reclassify** mark + rewrite eval cps (mistakes + praise); still upsert live bad-move / praise moment when mark holds. Comment dump stamps `event + note.id` (not weight breakdowns). `buildCoachNoteRequest` stamps MG centre strategy (`prefer_center_strike`, fluidity, exposure, wing, `pawn_break_class`) onto request + `coachRequestMetaInputs`; PGN `centre=strike=…`. `dump_coach_moments` rebuilds that stamp from FEN.
- Opening peer stamps need **numeric** rating + speed (or TimeControl→speed). Same bundled `opening_mix_lichess_v1.json` as Insights.
- **Games analyze pipeline:** (1) recalculate heuristics + every-ply SF + style/eval buckets + bundled peer baselines; (2) stamp mistake line metrics (`engineLine` / `playedLine` / `engineVsPlayed`); (3) only then Stage 1–3 comments + summary. Coach heuristics replace that game in the Metrics heuristics store; UI remeshes (no force re-analyze).
- `material_balance` = own−opp with p=1, n/b=3, r=5, q=9 (pawns included).
- Engine/played line: if leaf `hanging_material_own` or `hanging_material_opponent` ≠ 0, take **+1 ply** for the metric snap.
- Line compare = **best PV** vs **played move + engine continuation** (not the real game — opponent later errors do not pollute Δ).
- Opponent WP gifts: track pending chance for **missed** marks only — never inject `opponent_mistake` coach moments or tips (opp ply or reply).
- GPT tips: impersonal directive lists (pack v11+ with tip slots + conditions); soft-key id = metric lookup. Opening prose = `formatOpeningLabel` name, never raw ECO.
- **themesByPhase / globalThemes = soft-key metric ids** (`metricThemes.ts`), not free labels like `pawn_breaks`.
- Deterministic engine-line explain (`engineLineExplain.ts`): metric Δ → why-better + soft keys; opening principles when applicable.
- **why_better** still stamps moment inputs for metrics; comments do **not** dump why_better or pack paragraphs. When `detectTacticalFact` fires, Stage 2 prefers motif/attack notes with matching guards.
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
| Bad / brilliant / excellent marks | Flexible only (`bad_move` / `praise_move`); `important` is GIF-only; opp gifts do **not** create structural moments |

Quiet opening spam and quiet durable structure tips stay **off** — coach comments only from Stage 1 events (fixed checkpoints, live structural, bad, brilliant, excellent). Silence is the 2-rule manager only.

### Note selection (event → guarded template)
- [`notes_schema.json`](assets/coach/notes_schema.json) is the comment catalog. [`metricNoteKeys.ts`](src/engine/gameCoach/metricNoteKeys.ts) still maps metrics → soft keys for stamps / dump, not for `ply.note`.
- Pick: `eventKinds` match + all guards pass; most guards wins; tie → `id` sort.
- **Many notes per game OK** so long as each `keyId` / `note.id` is used once.
- No vault-candidate moments. No FEN/SAN matching. No theme-catalog browse for tip pick.

### Opening checkpoint inputs + soft keys
- Moments get an **opening metric snapshot** (`minors_developed`, `castle_fullmove`, `uncastled`, `center_control_pct`, `tempo_waste_rate_pct`, `space_advantage_pct`, …) via `openingCoachInputs.ts` — not only line Δ.
- **Peer comparison** (`peer_*` / `peer_delta_*`) from bundled baselines (`lookupBaseline`, rating×speed cell — same as Insights). Missing band/speed → skip peers, keep snapshot. Irregular ECO has no ECO-scoped peers.
- **Peer polarity** (Insights `metricPolarity`): `castle_fullmove` / `uncastled_rate` / `tempo_waste` = **lower better**; minors / centre / accuracy / space = **higher better**. `peer_signals` = `{metric, Δ, polarity, judgment}` with impact flipped so positive = good for the user.
- Soft keys for opening moments: **only** significant peer/snapshot judgments → metric keys (+ one `openingKeyId` when named). No principle laundry list (`pawn_break` / `candidate_moves` / prophylaxis fillers). Zero line Δ does not add keys.
- Opening peer/snapshot stamps still land on moment inputs. Comment text for `opening_name` / `opening_aggregate` comes from guarded checkpoint templates, not pack praise/nudge weaves.
- Tip stamps up to **3** `key_ids` on moment inputs (`key_id` primary + `key_ids` csv) when a comment attaches.
- Opening plans: pack plan only when a named `openingKeyId` resolves (not Irregular).
- Zone advances stay on snaps/diffs; tip topic threshold ≥4 so early checkpoints can use them if later Δ never grows.
- Open/semi-open file utilization: snap + MG/EG accumulator; soft keys `piece.coordination` / `imbalance.space` (not seventh-rank).
- Bishop snaps (per light/dark, own+opp): `bishop_diagonal_influence_*` (squares overseen on rays) and `bishop_openness_*` (empty diagonal squares). Phase `unblocking_bishop_*` = peak openness (not event counts). Soft keys: `positional.color_complexes`, bishop-pair / good-vs-bad.

### Finale
- [`gameSummary.ts`](src/engine/gameCoach/gameSummary.ts): **Early game / Middlegame / Late game** (metrics + checkpoints) + deterministic **Eval swings** block from `buildEvalSwingIndex` (biggest drop/surge + WP range + final band).

### Smoke
```bash
cd mobile && npx --yes tsx scripts/test-coach-moments.mjs
node scripts/test-adapt-note-squares.mjs
node scripts/test-coach-marks.mjs
npx --yes tsx scripts/test-phase-tactical-metrics.mjs
- Dump coach-call inputs + generated tips from annotate JSON (shows situations / tactical / game_plan / weight locks):
npx --yes tsx scripts/dump_coach_moments.mjs ../samples/metrics_all.json
npx --yes tsx scripts/dump_coach_moments.mjs ../samples/metrics_all.json --json
npx --yes tsx scripts/dump_coach_moments.mjs ../samples/metrics_all.json --comment-refs
npx --yes tsx scripts/dump_coach_moments.mjs ../samples/metrics_all.json --ignore-silence
# --comment-refs: top note choices + only coach-moment fields the tip text references
# --ignore-silence: skip ply-gap and unique-key silence (debug)
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
`pawn_break`, `defended_pawn`, `unblocking_bishop_{light,dark}`, `checks` (+pins), `blocking_checks`, phase `pawn_moves`, `king_attackers` (own+opp), MG/EG `seventh_rank_infiltration` (R+Q; phase accumulator + position snap of R/Q on 7th/2nd), MG/EG `open_file_utilization` (R+Q on open/semi-open; phase accumulator + position snap), EG `opposition`, zone pawn advances `queenside_advance` / `kingside_advance` / `center_advance` (+ `_opponent`). Hanging on snaps is material-value only: `hanging_material_own` / `hanging_material_opponent` (no piece-count fields). Centre strategy snaps: `center_fluidity_index`, `pawn_storm_tempo_delta`, `king_center_file_exposure`, `opp_king_in_centre` (d/e file), `opp_king_uncastled`.
