# Chess Wrapped — Data Specification

Detailed catalog of every datum ingested, computed, stored, or displayed by Chess Wrapped. Dual implementations exist: **TypeScript** (mobile happy path) and **Python** (baseline builders / offline tooling). Prefer TS for “what the app shows”; Python for “how peer baselines are built.”

---

## 0. Conventions

| Term | Meaning |
|------|---------|
| **Raw** | Platform payloads, PGN text, clock tags, Stockfish centipawn/`pv`, explorer move counts — not yet aggregated into Insights metrics |
| **Heuristic** | Derived from board geometry / piece placement / SAN only (no engine) |
| **Eval** | Requires Stockfish (or embedded `[%eval]`) win-probability trajectory |
| **Clock** | Derived from PGN `[%clk]` tags |
| **Per-game** | One row / object per analyzed game |
| **Aggregate** | Mean / rate / count over a filtered game set |
| **Baseline-normalized** | Peer z-score → logistic sigmoid in rating band × speed cell |
| **Archetype / radar** | Secondary transform: style + opening-mix → 0–100 trait scores |

### Phase boundaries

| Phase | Start | End |
|-------|-------|-----|
| **Opening** | Ply 0 | Fullmove `max(12, castle_fullmove)`, or 15 if never castled |
| **Middlegame** | Opening end ply | First ply with ≤7 non-pawn pieces (N/B/R/Q), or game end |
| **Endgame** | First ply with ≤7 non-pawn pieces | Game end |

### Shared win-probability primitives

| Symbol / constant | Value | Role |
|-------------------|-------|------|
| `winProbabilityFromCp(cp)` | `[0.01, 0.99]` | `1 / (1 + 10^(-(cp/100)/4))`; mate scores `|cp| ≥ 50000` clamp |
| `wpDropPp` | percentage points | `(wp_before − wp_after) × 100` |
| Blunder / Mistake / Inaccuracy | drop >15 / ≥10 / ≥5 pp | Move quality class |
| `WP_DISADVANTAGE` | 0.2 | Clearly worse |
| `WP_ENDGAME_ADVANTAGE` | 0.7 | Winning endgame threshold |
| `WP_DRAWISH_LO` / `HI` | 0.45 / 0.55 | Equal late game |
| Lichess-style accuracy | % | `103.1668 × exp(−0.04354 × ΔWP%) − 3.1669`, clamped `[0, 100]` |

**Sources:** `mobile/src/engine/winProb.ts`; mirrored in `opening_phase_metrics.py`, `endgame_phase_metrics.py`, `style_metrics.py`.

### End-to-end flow

```
Chess.com / Lichess APIs
        │
        ▼
NormalizedGame (platformGames.ts / load_data.py)
        │
        ├─► AsyncStorage user-games store
        │
        ├─► Heuristic pass ──► Opening / Middlegame / Endgame PGN metrics
        │
        ├─► Stockfish vault (depth 12–14) ──► evalsWhiteCp[]
        │         ├─► Eval-bucket metrics
        │         ├─► Style metrics
        │         └─► MistakeItem / OpeningMoment → Study
        │
        ├─► Aggregates ──► Recap / Insights (localRecap.ts ≈ stats.py)
        │
        └─► Peer compare ──► BaselineStore (JSON asset + /api/v1/baselines)
```

---

## 1. Ingest — NormalizedGame (raw → normalized)

Platform API responses are normalized into a common game record before any metric work.

### Schema

| Field | Kind | Type / unit | Definition |
|-------|------|-------------|------------|
| `id` | Raw | string | Platform game id |
| `created_at` | Raw | ISO datetime | Game end / creation time |
| `speed` | Transformed | enum | `bullet` \| `blitz` \| `rapid` \| `classical` \| `daily` — mapped from time control |
| `user_color` | Transformed | `white` \| `black` | Side the authenticated user played |
| `user_rating` | Raw | Elo | User rating at game time |
| `opp_rating` | Raw | Elo | Opponent rating |
| `opponent_name` | Raw | string | Opponent username |
| `result` | Transformed | `Win` \| `Draw` \| `Loss` | User-centric result (from platform winner / PGN result) |
| `opening_name` | Raw | string | Opening title from API or PGN |
| `opening_eco` | Raw | string | ECO code |
| `move_count` | Transformed | int | Approximate full-move count |
| `moves_str` | Raw | SAN string | Space-separated move list |
| `pgn_str` | Raw | PGN text | Full PGN (Chess.com always; Lichess often empty on server path) |
| `time_control` | Raw | `base+inc` | Clock setting string |
| `termination` | Transformed | string | How the user’s game ended (status map) |
| `opp_termination` | Transformed | string | Opponent-side termination |

**Types:** `StudyGame` / `NormalizedGame` — `mobile/src/engine/analyzeMistakes.ts`, `mobile/src/data/platformGames.ts`  
**Python:** `load_data.py` (`_parse_lichess_games`, `_parse_chesscom_games`)

### Storage (loaded into app)

| Store | Key / path | Contents | TTL |
|-------|------------|----------|-----|
| Device games | `@chess-wrapped:user-games:v1:{platform}\|{user}` | Normalized games + `watermark`, `coverage_since`, `last_fetched_at` | 24h fetch watermark |
| Device cache | `@chess-wrapped:v1:*` | API responses, insights slices | path-specific |
| Study vault | on-device analysis state | `evalsWhiteCp[]`, mistake candidates | ~7 days |
| Disk (API) | `.cache/explorer_lichess/`, `.cache/cloud_eval/` | Explorer / cloud eval JSON | permanent |
| Baselines | `.cache/baselines/` + `mobile/assets/baselines/` | Peer metric tables | permanent (device) |

---

## 2. Raw analysis outputs

### 2.1 Stockfish position eval

| Field | Kind | Unit | Definition |
|-------|------|------|------------|
| `cpWhite` | Raw | centipawns | White-perspective eval; mate encoded near ±50000 |
| `bestUci` | Raw | UCI | Best move at search depth |
| `evalsWhiteCp[]` | Raw array | cp per ply | Full-game eval trajectory (root + after each ply) |

**Sources:** `mobile/src/engine/globalAnalysis.ts`; Python `style_metrics.py` / `analyze_pgn_stockfish.py`. Scan defaults: `GLOBAL_DEPTH=14`, `SCAN_DEPTH=12` (`analysisConfig.ts`).

### 2.2 Mistake / opening moment (`MistakeItem`)

| Field | Kind | Definition |
|-------|------|------------|
| `game_id`, `created_at` | Raw meta | Game identity |
| Opening meta | Raw | ECO / name when available |
| `ply`, `fen` | Raw | Position of the moment |
| `played_uci` / `played_san` | Raw | Move played |
| `best_uci` / `best_san`, `best_pv` | Raw | Engine recommendation + PV |
| `continuation_source`, `gm_game` | Transformed | Masters / explorer continuation provenance |
| `eval_before_cp`, `eval_after_cp` | Raw | Eval around the move |
| `eval_delta_cp`, `eval_drop_cp` | Transformed | Signed / absolute cp change |
| `comment` | Transformed | Human-readable label |

**Source:** `mobile/src/api/client.ts`; produced by `analyzeMistakes.ts` / `analyzeOpenings.ts` / `globalAnalysis.ts`.

### 2.3 Explorer (API-loaded)

| Field | Kind | Definition |
|-------|------|------------|
| `ExplorerMove` | Raw | `{uci, san, white, draws, black, averageRating}` — master/Lichess database counts |
| `ExplorerTopGame` | Raw | Sample master game reference |

**Endpoint:** `GET /api/v1/study/explorer`. Disk cache under `.cache/explorer_lichess/`.

### 2.4 Clock parse

| Field | Kind | Unit | Definition |
|-------|------|------|------------|
| `user_times` / `opp_times` | Raw→list | seconds | Per-move think times from `[%clk]` |
| `user_avg` / `opp_avg` | Aggregate | seconds | Mean think time |
| `user_longest` / `opp_longest` | Aggregate | seconds | Max single-move think |

**Sources:** `stats.py` (`extract_move_times_from_pgn`); `mobile/src/engine/clockFromPgn.ts`.

### 2.5 PGN eval tokens

`[%eval …]` comments → `extract_evals_white_cp_from_pgn` (`style_metrics.py`). Used when engine is unavailable but annotated PGN exists (sample / debug PGNs under `samples/`).

### 2.6 Annotation script dump

`scripts/annotate_metrics_pgn.ts` writes `Heuristic*` / `Eval*` headers into sample PGNs for parity checking between TS and Python.

---

## 3. Opening-phase metrics

**Modules:** `opening_phase_metrics.py`, `mobile/src/engine/openingPhase.ts`  
**Phase end:** `opening_phase_end_fullmove(castle)` = `max(12, castle)` or 15 if uncastled.

### 3.1 Per-game (`OpeningGameRow`)

| Metric | Kind | Unit | Specification |
|--------|------|------|---------------|
| `opening_accuracy_pct` | Eval | % | Mean Lichess-style accuracy on user moves inside opening phase |
| `opening_minors_developed_by_10` | Heuristic | 0–4 | Count of N/B not on home squares at fullmove 10 (capped at 4) |
| `opening_center_control_pct` | Heuristic | % | Share of `{d4,e4,d5,e5}` occupied or attacked by user × 100 |
| `opening_castle_fullmove` | Heuristic | fullmove | First castling fullmove number |
| `uncastled` | Heuristic | bool | Never castled in game |
| `opening_tempo_waste_rate_pct` | Heuristic | % | Among piece moves before 4 minors developed: share that re-move a piece already moved |
| `opening_pawn_moves` | Heuristic | count | User pawn moves in opening |
| `accuracy_moves` | Meta | count | Moves that contributed to accuracy |
| `phase_end_fullmove` | Meta | fullmove | Opening → middlegame boundary |

### 3.2 Aggregate (`OpeningMetricsAggregate`)

| Metric | Kind | Unit | Specification |
|--------|------|------|---------------|
| `opening_accuracy_pct` | Eval | % | Mean over games with accuracy samples |
| `opening_minors_developed_by_10` | Heuristic | mean | |
| `opening_center_control_pct` | Heuristic | % mean | |
| `opening_castle_fullmove` | Heuristic | mean | Over castled games |
| `opening_uncastled_rate_pct` | Heuristic | % | Games never castled / games |
| `opening_tempo_waste_rate_pct` | Heuristic | % mean | |
| `opening_pawn_moves_avg` | Heuristic | mean | |
| `games`, `castled_games`, `accuracy_games` | Meta | counts | |

Also: per-side opening cards (`OpeningSideCard` / `top_openings_by_side`) with `games`, `win_rate`, and the same opening metric fields.

**Baseline keys:** `OPENING_PGN_METRIC_KEYS` + `opening_accuracy_pct`.

---

## 4. Middlegame-phase metrics

**Modules:** `middlegame_phase_metrics.py`, `mobile/src/engine/middlegamePhase.ts`  
**Bounds:** plies after opening end until endgame start (`non_pawn ≤ 7`).

### 4.1 Per-game (`MiddlegameGameRow`)

| Metric | Kind | Unit | Specification |
|--------|------|------|---------------|
| `reached_middlegame` | Meta | bool | Phase occurred |
| `middlegame_start_ply` / `end_ply` | Meta | ply | Inclusive/exclusive bounds (TS) |
| `middlegame_accuracy_pct` | Eval | % | Accuracy on user MG moves |
| `middlegame_accuracy_moves` | Meta | count | |
| `middlegame_blunders` / `_mistakes` / `_inaccuracies` | Eval | count | WP-drop classes in MG |
| `middlegame_missed_opportunity_pct` | Eval | % | After opponent blunder/mistake: share of chances where user failed to punish (WP not recovered) |
| `middlegame_missed_tactic_pct` | Eval | % | Missed material tactic after opponent blunder |
| `middlegame_allowed_tactic_pct` | Eval | % | Opponent finds tactic after user’s blunder |
| `middlegame_king_attackers_score` | Heuristic | 0–100 | Squared sum of piece-power of unique opponents attacking king-zone squares, scaled to max (Q+2R+2B+2N)² |
| `middlegame_pawn_shield_pct` | Heuristic | % | Castled-wing pawn shield integrity (penalties for missing/advanced shield pawns); null if king not on castled home |
| `middlegame_open_file_proximity_pct` | Heuristic | % | Exposure of king to open / semi-open files |
| `middlegame_safe_moves_pct` | Heuristic | % | Share of legal moves whose landing square is not attacked by an enemy pawn |
| `middlegame_outpost_control` | Heuristic | count | User minors on outpost squares (supported, cannot be driven by enemy pawn) |
| `middlegame_space_advantage_pct` | Heuristic | % | Share of safe central space controlled by user |
| `had_iqp` | Heuristic | bool | Isolated queen pawn appeared |
| `had_doubled_pawns` | Heuristic | bool | Doubled pawns appeared |
| `had_backward_pawns` | Heuristic | bool | Backward pawns appeared |
| `middlegame_pawn_islands_avg` | Heuristic | count | Mean pawn-island count during MG samples |
| `result` | Meta | Win/Draw/Loss | |

### 4.2 Eval bucket (per-game intermediate)

`MiddlegameEvalBucket`: `accuracy_pct`, `accuracy_moves`, `blunders`, `mistakes`, `inaccuracies`, `tactics_made`, `missed_opportunity_chances` / `opportunities`, `missed_tactic_chances` / `tactics`, `allowed_tactic_chances` / `tactics_found`.

### 4.3 Aggregate keys

**Heuristic (`MIDDLEGAME_PGN_METRIC_KEYS`):**  
`middlegame_king_attackers_score`, `middlegame_pawn_shield_pct`, `middlegame_open_file_proximity_pct`, `middlegame_safe_moves_pct`, `middlegame_outpost_control_avg`, `middlegame_space_advantage_pct`, `middlegame_iqp_win_rate_pct`, `middlegame_doubled_pawns_game_pct`, `middlegame_backward_pawns_game_pct`, `middlegame_pawn_islands_avg`

**Eval (`MIDDLEGAME_EVAL_METRIC_KEYS`):**  
`middlegame_accuracy_pct`, `middlegame_blunder_avg`, `middlegame_mistake_avg`, `middlegame_inaccuracy_avg`, `middlegame_missed_opportunity_pct`, `middlegame_missed_tactic_pct`, `middlegame_allowed_tactic_pct`

| Aggregate field | Transform |
|-----------------|-----------|
| `*_avg` counts | Mean blunders/mistakes/inaccuracies per MG game |
| `middlegame_iqp_win_rate_pct` | Win rate in games that had IQP |
| `middlegame_doubled_pawns_game_pct` | % of MG games with doubled pawns |
| `middlegame_backward_pawns_game_pct` | % of MG games with backward pawns |
| `middlegame_outpost_control_avg` | Mean outpost count |

---

## 5. Endgame-phase metrics

**Modules:** `endgame_phase_metrics.py`, `mobile/src/engine/endgamePhase.ts`  
**Start:** first ply with `non_pawn_piece_count ≤ 7`.

### 5.1 Theoretical ending classifiers (`THEORETICAL_KEYS`)

Each hit yields aggregate `{key}_win_rate_pct` and `{key}_draw_rate_pct` when that material pattern appears.

| Key | Material pattern (summary) |
|-----|----------------------------|
| `te_pawn_endings` | Both sides bare (no Q/R/B/N), ≥1 pawn |
| `te_queen_vs_pawn` | Q vs bare + pawn(s) |
| `te_rook_vs_pawn` | R vs bare + pawn(s) |
| `te_bishop_pawn_vs_knight` | B+P vs N (and symmetric variants as coded) |
| `te_opp_bishop_two_pawns` | Opposite-colored bishops with two pawns context |
| `te_pawn_vs_knight` | Pawn(s) vs lone knight |
| `te_two_pawns_vs_rook` | Two pawns vs rook |
| `te_knight_pawn_vs_bishop` | N+P vs B |
| `te_rook_pawn_vs_rook` | R+P vs R |

`advantage_only` endings track whether the user was the strong side; `theoretical_saved` flags weaker-side survival.

### 5.2 Per-game (`EndgameGameRow`)

| Metric | Kind | Unit | Specification |
|--------|------|------|---------------|
| `reached_endgame` | Meta | bool | |
| `endgame_start_ply` | Meta | ply | |
| `king_centralization` | Heuristic | ~0–3 | Mean Chebyshev closeness of user king to board center during EG |
| `king_distance` | Heuristic | squares | Mean Chebyshev distance user king → nearest enemy pawn |
| `pawn_diff` | Heuristic | pawns | Mean (user − opp) pawn count in EG |
| `blunders` | Eval | count | Blunders in theoretical / EG contexts |
| `piece_trades` | Eval | count | Piece exchanges detected in EG window |
| `beneficial_trades` | Eval | count | Trades that improve user WP |
| `winning_trades` | Eval | count | Trades while already winning |
| `simplification_trades` | Eval | count | Equal trades that simplify a won position |
| `mate_episodes` / `mate_converted` | Eval | counts | Mate-score episodes that become actual mate |
| `accidental_stalemate` | Eval | bool | Stalemate while user WP ≥ 0.7 |
| `mate_move_times` | Clock | seconds[] | Think times during mate sequences |
| `theoretical` | Heuristic | map | Ending keys hit this game |
| `theoretical_saved` | Heuristic | bool | Weaker side of an advantage-only ending |

### 5.3 Eval bucket (`EndgameEvalBucket`)

`blunders`, `mistakes`, `inaccuracies`, tactics / missed-opp fields, trade fields, mate fields, `accidental_stalemate`, `mate_move_times`.

### 5.4 Aggregate keys

**Heuristic (`ENDGAME_PGN_METRIC_KEYS`):**  
`endgame_king_centralization`, `endgame_king_distance`, `endgame_pawn_diff`, `endgame_stalemate_pct`, `endgame_theoretical_saved_win_pct`, `endgame_theoretical_saved_draw_pct`, plus all `te_*_{win,draw}_rate_pct`

**Eval (`ENDGAME_EVAL_METRIC_KEYS`):**  
`endgame_blunder_avg`, `endgame_beneficial_trade_pct`, `endgame_simplification_trade_pct`, `endgame_mate_conversion_pct`, `endgame_mate_avg_seconds`

| Aggregate | Transform |
|-----------|-----------|
| `endgame_stalemate_pct` | % EG games ending accidental stalemate |
| `endgame_beneficial_trade_pct` | beneficial / piece_trades |
| `endgame_simplification_trade_pct` | simplification / piece_trades |
| `endgame_mate_conversion_pct` | mate_converted / mate_episodes |
| `endgame_mate_avg_seconds` | Mean think time in mate sequences |

---

## 6. Style-of-play metrics

**Modules:** `style_metrics.py`, `mobile/src/engine/styleMetrics.ts`  
Whole-game behavioral profile (cross-phase). Peer analysis entry: `analyze_peer_game_metrics` → `{opening, middlegame, endgame, style}`.

### 6.1 Per-game (`StyleGameRow`)

| Metric | Kind | Unit | Specification |
|--------|------|------|---------------|
| `volatility_cp` | Eval | cp | Std-dev of successive user-pov eval deltas |
| `sacrifice_moves` / `had_sacrifice` | Eval | count / bool | Unrecovered material offers (≥3 pawns of value) |
| `early_flank_pushes` / `had_early_flank` | Heuristic | count / bool | a/h (flank) pawn advances into enemy half by move ≤12 |
| `had_endgame_advantage` / `converted_endgame` | Eval | bool | User WP ≥ 0.7 in EG → eventual win |
| `territory_own` / `territory_opp` | Heuristic | count | Piece landings on own / opponent half-board |
| `territory_opp_pct` | Transformed | % | `opp / (own + opp)` |
| `early_trades` / `had_early_trade` | Heuristic | count / bool | Piece trades by move ≤12 |
| `trades_near_enemy_king` / `trades_near_user_king` | Heuristic | count | Captures within Chebyshev ≤2 of that king |
| `forward` / `backward` / `lateral_moves` | Heuristic | count | Direction of non-pawn piece moves relative to user side |
| `higher_threats` | Heuristic | count | Attacks on higher-value enemy pieces |
| `threat_escapes` | Heuristic | count | Escapes from such threats |
| `user_moves` | Meta | count | |
| `avg_time_per_move_s` / `opp_avg_*` / `clock_diff_s` | Clock | seconds | From `[%clk]`; diff = user − opp avg |
| `drawishless` | Eval | bool | Late drawish WP band (0.45–0.55 from move 40+) finished decisive |
| `declined_recaptures` / `recapture_chances` | Heuristic | count | Refused legal recaptures |
| `critical_move_times` / `avg_critical_time_s` / `critical_positions` | Clock+Eval | s | Think time on sharp WP swings |
| `had_disadvantage` / `recovered_from_disadvantage` | Eval | bool | WP ≤ 0.2 then recovered |
| `blunders` / `blunder_rate_pct` | Eval | count / % | |
| `disadvantage_move_times` / `avg_disadvantage_time_s` | Clock+Eval | s | Think while worse |

### 6.2 Aggregate groups

**Top-level:** `games`, `wins`, `win_rate`, `avg_time_per_move_s`, `games_with_clock`, `per_game[]`

**`initiative`:**  
`avg_eval_volatility_cp`, `sacrifice_rate_pct`, `avg_sacrifice_moves`, `early_flank_rate_pct`, `avg_early_flank_pushes`, `endgame_advantage_games`, `endgame_conversion_rate_pct`, `early_trade_rate_pct`, `avg_early_trades`

**`attacking`:**  
`avg_higher_value_threats`, `avg_threat_escapes`, `avg_trades_near_enemy_king`, `avg_trades_near_user_king`, `territory_opp_pct`, `territory_own_pct`, `forward_move_pct`, `backward_move_pct`, `lateral_move_pct`

**`creativity`:**  
`drawishless_games`, `drawishless_rate_pct`, `declined_recapture_rate_pct`, `declined_recaptures`, `recapture_chances`, `avg_declined_recaptures`, `avg_critical_time_s`, `critical_positions`, `avg_critical_positions`

**`durability`:**  
`disadvantage_games`, `recovered_games`, `recovery_rate_pct`, `total_blunders`, `avg_blunders`, `blunder_rate_pct`, `avg_clock_diff_s`, `avg_disadvantage_time_s`, `disadvantage_positions`

---

## 7. Opening mix & positional texture

### 7.1 Opening mix

**Modules:** `stats.calculate_opening_mix_stats`, `mobile/src/engine/openingMix.ts`

| Field | Kind | Unit | Specification |
|-------|------|------|---------------|
| `same_openings` / `different_openings` | Aggregate | games, wins, win_rate | Vs signature ECO per context (White e4/d4; Black vs e4/d4) |
| `orthodox` / `unorthodox` | Aggregate | same | Mainstream vs side ECO/name buckets |
| `same_opening_rate` / `different_opening_rate` | Transformed | % | Flattened for baselines |
| `orthodox_rate` / `unorthodox_rate` | Transformed | % | |
| `*_rate_pct` | Transformed | % | TS display aliases of the above |
| `avg_time_per_move_s` | Clock | s | Mix-path clock mean |
| `signature_openings` | Transformed | map | Per-context signature opening |

### 7.2 Positional / imbalance texture

**Module:** `stats.py` (~positional imbalance section)

| Field | Kind | Unit | Specification |
|-------|------|------|---------------|
| `closed` / `semi_closed` / `other` | Aggregate | bucket WR | By ECO class |
| `closed_share_pct` / `semi_closed_share_pct` | Transformed | % | Game share |
| `pawn_diff_game_rate_pct` | Heuristic | % | Games with pawn-count imbalance |
| `piece_diff_game_rate_pct` | Heuristic | % | Games with piece-count imbalance |
| `bishop_vs_knight_game_rate_pct` | Heuristic | % | B-vs-N imbalance games |
| `rook_vs_two_minors_game_rate_pct` | Heuristic | % | R vs two minors games |
| `locked_position_rate_pct` / `locked_game_rate_pct` | Heuristic | % | Low pawn-mobility / locked structures |
| `avg_pawn_moves` / `avg_user_pawn_moves` | Heuristic | count | |
| `avg_max_pawn_diff` / `avg_max_piece_diff` | Heuristic | count | Peak imbalance during game |

---

## 8. Recap & Insights aggregates

**Modules:** `stats.py`, `mobile/src/engine/localRecap.ts` (and related selectors)  
**Types:** `RecapResponse`, `InsightsResponse` in mobile API types.

### 8.1 Headline

| Field | Kind | Specification |
|-------|------|---------------|
| `total_games` | Aggregate | Filtered game count |
| `total_moves` | Aggregate | Sum of moves |
| `total_hours` | Transformed | Estimated play time via speed × moves (`SECONDS_PER_MOVE` table) |
| `max_win_streak` / `max_unbeaten_streak` / `current_win_streak` | Aggregate | Streak lengths |
| `peak_day` / `peak_hour` | Aggregate | Mode of activity |

### 8.2 Activity

| Field | Kind | Specification |
|-------|------|---------------|
| `hourly_activity[]` | Aggregate | `{hour, label, games, wins}` |
| `monthly_activity[]` | Aggregate | `{month, month_key, games, wins, rating}` |
| `results_breakdown` | Aggregate | `{wins, draws, losses, win_rate}` |

### 8.3 Opening repertoire cards

| Field | Kind | Specification |
|-------|------|---------------|
| `sig_white` / `sig_black`, `sig_*_eco` | Transformed | Signature openings by color |
| `secret_weapon` / `nemesis` | Transformed | High WR rare opening / low WR frequent opening |
| `total_gambits` / `gambit_win_rate` | Aggregate | Gambit-tagged openings |
| `op_group` / `var_group` / `eco_map` | Aggregate | Grouped repertoire maps |

### 8.4 Clock stats

| Field | Kind | Specification |
|-------|------|---------------|
| `user_timeouts` / `opp_timeouts` | Aggregate | Flag/termination counts |
| `timeout_decided_games` / WR | Aggregate | Games decided on time |
| `games_with_clock` | Meta | |
| `avg_time_per_move_user` / `opp` | Clock | seconds |
| `avg_longest_move_user` / `opp` | Clock | seconds |
| `won_on_time_wr` / `lost_on_time_wr` | Aggregate | % |
| `slower_avg_wr` / `longer_think_wr` | Aggregate | Conditional WR when slower / longer thinks |

### 8.5 Notation / interaction flavor

From `parse_game_interactions` → `calculate_notation_stats`:

| Field | Kind | Specification |
|-------|------|---------------|
| `knights_captured` / `bishops_captured` | Heuristic | Capture counts |
| `queenless_pct` | Heuristic | % games that went queenless |
| `first_blood_pct` | Heuristic | % games where user took first piece |
| `castling_counts` | Heuristic | `{Kingside, Queenside, Uncastled}` |
| `promotions_total` / `underpromotions` | Heuristic | `{Q,N,R,B}` and underpromo count |
| `checkmate_finishers` | Heuristic | Piece that delivered mate |
| `endgame_types` | Heuristic | Coarse EG type labels |
| `captured_piece_weight_g` | Transformed | Fun physical-weight estimate of captured material |

### 8.6 Coarse endgame length

| Field | Kind | Specification |
|-------|------|---------------|
| `short_games_count` / WR | Aggregate | ≤30 moves |
| `marathon_games_count` / WR | Aggregate | >50 moves |
| `win_methods` / `loss_methods` | Aggregate | Termination breakdown |

### 8.7 Conditional factors

| Field | Kind | Specification |
|-------|------|---------------|
| `baseline_win_rate` | Aggregate | Overall WR |
| `white_win_rate` / `black_win_rate` / `color_bias` | Aggregate | Color splits |
| `underdog_win_rate` / `favored_win_rate` | Aggregate | Rating-gap splits |
| `fb_user` / `fb_opp` WR | Aggregate | First-blood conditionals |
| `modifiers[]` | Transformed | `{Condition, Diff}` vs baseline WR |

### 8.8 Badges & fun comparisons

- **Badges:** thresholded archetypes (e.g. Giant Killer, First Blood, Endgame Virtuoso) from `stats.py`
- **Fun comparisons:** `books_read`, `movies_watched`, `km_walked`, `captured_piece_weight_g` — narrative transforms of play volume / captures

---

## 9. Archetype & radar transforms

**Spec:** `chess_traits_classifier.md`  
**Code:** `mobile/src/engine/archetypeScores.ts`

### 9.1 Pipeline

1. Feature extraction (style + opening mix + clock quality)  
2. Elo × time-control baseline normalization: `z = (x − μ) / σ` → `f_norm = 1 / (1 + e^(−z))`  
3. Secondary group aggregation  
4. Hybrid cosine + Euclidean match → score ∈ [0, 100]

### 9.2 Normalized user-vector features (`[0, 1]`)

| Feature | Upstream metrics |
|---------|------------------|
| `same_openings` | Opening-mix same-opening rate |
| `orthodox` | Orthodox opening rate |
| `maneuver_style` | Low volatility, low sacrifice, high EG conversion, early trades |
| `initiative_style` | High volatility, sacrifice, early flank |
| `intuitive_style` | Volatility + sacrifice + opp territory + flank |
| `overall_time_quality` | Peer-normalized avg time / move |
| `critical_time_quality` | Peer-normalized critical think time |
| `disadvantage_time_quality` | Peer-normalized disadvantage think time |

### 9.3 Secondary groups

| Group | Upstream |
|-------|----------|
| `creativity` | Drawishless, declined recapture, critical time |
| `attacking` | Higher-value threats, trades near enemy king, forward %, territory |
| `positioning` | Closed/semi-closed share, locked rates, piece balance |
| `defense` | Threat escapes, trades near own king, low blunders |
| `durability` | Recovery rate, clock diff, blunder resilience |

### 9.4 Output

| Output | Unit | Specification |
|--------|------|---------------|
| 9 × `ArchetypeScore` | 0–100 | Technical, Positional, Attacking, Calculating, Tricky, Dynamic, Practical, Intuitive, Logical |
| `StyleRadarAxis[]` | 0–100 | Dimension scores for radar UI |

---

## 10. Peer baselines (loaded into app)

### 10.1 Cell partitioning

| Axis | Values |
|------|--------|
| Rating bands | `800-999` … `2200-2399`, `2400+` (`baselines.py` / `baselines.ts`) |
| Speeds | `bullet`, `blitz`, `rapid`, `classical` |
| Cell key | `{band}\|{speed}` |

### 10.2 Row schema (`BaselineRow`)

| Field | Kind | Definition |
|-------|------|------------|
| `metric` | key | Metric name (see catalogs below) |
| `rating_band` / `speed` | partition | Cell |
| `mean` | Aggregate | Cell mean |
| `n` | Meta | Sample size |
| `source_month` / `sample` | Meta | Provenance |
| `p10`…`p90` | Aggregate | Percentiles |
| `values` | Raw sample | Sorted values for exact percentile rank (activity metrics) |

**Store:** `BaselineStore` — `available`, `bands`, `speeds`, `rows`, `by_cell`.  
**API:** `GET /api/v1/baselines`. Device cache key `baselines:store:v3` (permanent TTL).  
**Bundled asset:** `mobile/assets/baselines/opening_mix_lichess_v1.json` (subset of full catalog).

### 10.3 Metric catalogs

**Activity (`ACTIVITY_METRIC_KEYS`):**  
`avg_games_per_player_{month,week,day}`, `avg_est_seconds_per_player_{month,week,day}`

**PGN (`PGN_METRIC_KEYS`):** win rate, est seconds/game, activity keys, opening-mix rates, texture rates, style PGN-shared fields, opening/MG/EG heuristic keys.

**Eval (`EVAL_METRIC_KEYS`):** volatility, sacrifice, drawishless, recovery, blunders, EG conversion, critical/disadv times, territory/threats, opening/MG/EG eval keys.

**UI alias map:** `STYLE_BASELINE_METRIC` in `baselines.ts` maps Insights display keys (often `*_rate_pct`) → baseline keys (often `*_rate`).

### 10.4 Builders

| Script | Role |
|--------|------|
| `scripts/build_lichess_baselines.py` | Monthly Lichess DB → PGN/eval cell metrics |
| `scripts/build_lichess_activity_baselines.py` | Per-player games/time → activity baselines |
| `scripts/run_lichess_baselines_month.py` | Orchestrate month run |
| `scripts/run_lichess_activity_month.py` | Activity month run |
| `baselines.flatten_pgn_cell_metrics` / `flatten_eval_cell_metrics` | Dict flattening |
| `baselines.sync_mobile_baseline_asset` | Copy JSON → mobile assets |

Estimated seconds use `SECONDS_PER_MOVE`: bullet 3, blitz 8, rapid 20, classical/daily 60.

---

## 11. Mobile consumption map

| UI surface | Primary data | Generator |
|------------|--------------|-----------|
| Recap | Headline, activity, rating, badges, comparisons | `localRecap.ts` |
| Insights factors | Conditional WR diffs | `localRecap` / selectors |
| Style of Play | Style aggregates + peer Δ | `styleMetrics` + baselines |
| Opening / MG / EG panels | Phase aggregates | `openingPhase` / `middlegamePhase` / `endgamePhase` |
| Style radar / archetypes | Normalized vector + scores | `archetypeScores.ts` |
| Metrics catalog | Display defs | `selectors.selectMetricsCatalog` |
| Study mistakes / openings | `MistakeItem` / opening moments | `globalAnalysis` / `analyzeMistakes` / `analyzeOpenings` |
| Opening prep | Explorer + masters PGN | API + `analyzeOpenings.ts` |

---

## 12. Type / module index

| Structure | Location |
|-----------|----------|
| `NormalizedGame`, `UserGamesStore` | `mobile/src/data/platformGames.ts` |
| `StudyGame`, analyze progress | `mobile/src/engine/analyzeMistakes.ts` |
| `MistakeItem`, `BaselinesResponse`, `ExplorerMove` | `mobile/src/api/client.ts` |
| `BaselineRow`, `BaselineStore`, `STYLE_BASELINE_METRIC` | `mobile/src/data/baselines.ts` |
| Win-prob constants | `mobile/src/engine/winProb.ts` |
| Opening phase | `openingPhase.ts` / `opening_phase_metrics.py` |
| Middlegame phase | `middlegamePhase.ts` / `middlegame_phase_metrics.py` |
| Endgame phase | `endgamePhase.ts` / `endgame_phase_metrics.py` |
| Style metrics | `styleMetrics.ts` / `style_metrics.py` |
| Opening mix | `openingMix.ts` / `stats.py` |
| Archetypes | `archetypeScores.ts` / `chess_traits_classifier.md` |
| Global analysis vault | `globalAnalysis.ts` |
| Recap / Insights | `localRecap.ts` / `stats.py` |
| Metric key catalogs | `baselines.py` |
| Sample parity PGNs | `samples/metrics_*.pgn` |

There is no shared Python `dataclass` layer for metrics — shapes are plain `dict` returns plus TS `type` aliases. API Pydantic models cover filters / health / games only.

---

## 13. Complete baseline-aware metric name list

Everything the app can resolve via `STYLE_BASELINE_METRIC` / `PGN_METRIC_KEYS` / `EVAL_METRIC_KEYS` / activity / theoretical:

**Activity:** `avg_games_per_player_{month,week,day}`, `avg_est_seconds_per_player_{month,week,day}`

**Results / time:** `win_rate`, `est_seconds_per_game`, `avg_time_per_move_s`, `avg_clock_diff_s`, `avg_disadvantage_time_s`, `avg_critical_time_s`

**Opening mix:** `same_opening_rate`, `different_opening_rate`, `orthodox_rate`, `unorthodox_rate`

**Texture:** `pawn_diff_game_rate_pct`, `piece_diff_game_rate_pct`, `bishop_vs_knight_game_rate_pct`, `rook_vs_two_minors_game_rate_pct`, `locked_position_rate_pct`, `locked_game_rate_pct`, `avg_pawn_moves`, `avg_user_pawn_moves`

**Style:** `avg_eval_volatility_cp`, `avg_sacrifice_moves`, `sacrifice_rate_pct`, `early_flank_rate_pct`, `avg_early_flank_pushes`, `endgame_conversion_rate_pct`, `early_trade_rate_pct`, `avg_early_trades`, `avg_higher_value_threats`, `avg_threat_escapes`, `avg_trades_near_enemy_king`, `avg_trades_near_user_king`, `territory_opp_pct`, `territory_own_pct`, `forward_move_pct`, `backward_move_pct`, `drawishless_rate_pct`, `declined_recapture_rate_pct`, `recovery_rate_pct`, `avg_blunders`

**Opening phase:** `opening_accuracy_pct`, `opening_minors_developed_by_10`, `opening_center_control_pct`, `opening_castle_fullmove`, `opening_uncastled_rate_pct`, `opening_tempo_waste_rate_pct` (+ aggregate-only `opening_pawn_moves_avg`)

**Middlegame:** all §4 heuristic + eval keys

**Endgame:** all §5 heuristic + eval + `te_*_{win,draw}_rate_pct` keys

---

## 14. Kind legend (quick reference)

| Kind | Engine? | Clock? | Typical stage |
|------|---------|--------|---------------|
| Raw | sometimes | sometimes | Ingest / Stockfish / API |
| Heuristic | no | no | Per-game phase / style |
| Eval | yes | no | Per-game phase / style |
| Clock | no | yes | Style / Recap |
| Aggregate | n/a | n/a | Insights / Recap / baselines |
| Transformed | n/a | n/a | Rates, biases, archetypes, fun comps |
| Meta | n/a | n/a | Counts, flags, phase bounds |

Related deep-dive: [chess_traits_classifier.md](./chess_traits_classifier.md) (archetype math). Architecture overview: [README.md](./README.md).
