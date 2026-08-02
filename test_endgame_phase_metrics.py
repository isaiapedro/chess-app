from __future__ import annotations

import chess

from endgame_phase_metrics import (
    ENDGAME_NON_PAWN_MAX,
    aggregate_endgame_metrics,
    analyze_endgame_game,
    classify_theoretical,
    king_centralization_score,
    non_pawn_piece_count,
)


def test_endgame_start_threshold() -> None:
    board = chess.Board()
    assert non_pawn_piece_count(board) == 14
    assert non_pawn_piece_count(board) > ENDGAME_NON_PAWN_MAX

    board = chess.Board("4k3/8/8/8/8/8/8/4K3 w - - 0 1")
    assert non_pawn_piece_count(board) == 0
    assert non_pawn_piece_count(board) <= ENDGAME_NON_PAWN_MAX


def test_classify_pawn_ending() -> None:
    board = chess.Board("4k3/4p3/8/8/8/8/4P3/4K3 w - - 0 1")
    hit = classify_theoretical(board, chess.WHITE)
    assert hit is not None
    assert hit["key"] == "te_pawn_endings"
    assert hit["advantage_only"] is False


def test_classify_rook_vs_pawn_advantage() -> None:
    board = chess.Board("4k3/4p3/8/8/8/8/8/R3K3 w - - 0 1")
    white = classify_theoretical(board, chess.WHITE)
    assert white is not None
    assert white["key"] == "te_rook_vs_pawn"
    assert white["advantage_only"] is True
    assert white["user_has_advantage"] is True

    black = classify_theoretical(board, chess.BLACK)
    assert black is not None
    assert black["key"] == "te_rook_vs_pawn"
    assert black["user_has_advantage"] is False


def test_classify_pawn_vs_knight_both() -> None:
    board = chess.Board("4k3/4p3/8/8/8/8/8/4K1N1 w - - 0 1")
    hit = classify_theoretical(board, chess.WHITE)
    assert hit is not None
    assert hit["key"] == "te_pawn_vs_knight"
    assert hit["advantage_only"] is False


def test_classify_bishop_pawn_vs_knight() -> None:
    board = chess.Board("4k3/8/8/8/8/8/4P3/4KBN1 w - - 0 1")
    # White: K B N P — not matching. Need B+P vs N only.
    board = chess.Board("4k1n1/8/8/8/8/8/4P3/4KB2 w - - 0 1")
    white = classify_theoretical(board, chess.WHITE)
    assert white is not None
    assert white["key"] == "te_bishop_pawn_vs_knight"
    assert white["user_has_advantage"] is True
    black = classify_theoretical(board, chess.BLACK)
    assert black is not None
    assert black["user_has_advantage"] is False


def test_king_centralization() -> None:
    board = chess.Board("4k3/8/8/8/3K4/8/8/8 w - - 0 1")
    score = king_centralization_score(board, chess.WHITE)
    assert score == 4.0


def test_analyze_reaches_endgame() -> None:
    pgn = """[Event "?"]
[Site "?"]
[Date "2024.01.01"]
[Round "?"]
[White "A"]
[Black "B"]
[Result "1/2-1/2"]
[FEN "4k3/4p3/8/8/8/8/8/R3K3 w - - 0 1"]
[SetUp "1"]

1. Ra7 Kf8 2. Ra8+ Ke7 3. Ra7+ Kd8 4. Ra8+ Ke7 1/2-1/2
"""
    row = analyze_endgame_game(pgn, "white", result="Draw")
    assert row is not None
    assert row["reached_endgame"] is True
    assert row["endgame_start_ply"] is not None
    assert row["king_centralization"] is not None
    assert row.get("theoretical", {}).get("te_rook_vs_pawn") is True


def test_saved_disadvantage_side() -> None:
    pgn = """[Event "?"]
[Site "?"]
[Date "2024.01.01"]
[Round "?"]
[White "A"]
[Black "B"]
[Result "1/2-1/2"]
[FEN "4k3/4p3/8/8/8/8/8/R3K3 w - - 0 1"]
[SetUp "1"]

1. Ra7 Kf8 2. Ra8+ Ke7 3. Ra7+ Kd8 4. Ra8+ Ke7 1/2-1/2
"""
    as_black = analyze_endgame_game(pgn, "black", result="Draw")
    assert as_black is not None
    assert as_black["reached_endgame"] is True
    assert as_black["theoretical_saved"] is True
    assert not as_black.get("theoretical", {}).get("te_rook_vs_pawn")


def test_aggregate_stalemate_and_theoretical() -> None:
    rows = [
        {
            "reached_endgame": True,
            "blunders": 1,
            "king_centralization": 2.0,
            "king_distance": 3.0,
            "pawn_diff": 1.0,
            "piece_trades": 2,
            "beneficial_trades": 1,
            "winning_trades": 1,
            "simplification_trades": 1,
            "mate_episodes": 1,
            "mate_converted": 1,
            "accidental_stalemate": True,
            "mate_move_times": [2.0],
            "theoretical": {"te_pawn_endings": True},
            "theoretical_saved": True,
            "result": "Draw",
        },
        {
            "reached_endgame": True,
            "blunders": 0,
            "king_centralization": 3.0,
            "king_distance": 2.0,
            "pawn_diff": 0.0,
            "piece_trades": 0,
            "beneficial_trades": 0,
            "winning_trades": 0,
            "simplification_trades": 0,
            "mate_episodes": 0,
            "mate_converted": 0,
            "accidental_stalemate": False,
            "mate_move_times": [],
            "theoretical": {"te_pawn_endings": True},
            "theoretical_saved": False,
            "result": "Win",
        },
    ]
    agg = aggregate_endgame_metrics(rows)
    assert agg["endgame_games"] == 2
    assert agg["endgame_stalemate_pct"] == 50.0
    assert agg["endgame_mate_conversion_pct"] == 100.0
    assert agg["te_pawn_endings_win_rate_pct"] == 50.0
    assert agg["te_pawn_endings_draw_rate_pct"] == 50.0
    assert agg["endgame_simplification_trade_pct"] == 100.0
    assert agg["endgame_theoretical_saved_draw_pct"] == 100.0
    assert agg["endgame_theoretical_saved_win_pct"] == 0.0


if __name__ == "__main__":
    test_endgame_start_threshold()
    test_classify_pawn_ending()
    test_classify_rook_vs_pawn_advantage()
    test_classify_pawn_vs_knight_both()
    test_classify_bishop_pawn_vs_knight()
    test_king_centralization()
    test_analyze_reaches_endgame()
    test_saved_disadvantage_side()
    test_aggregate_stalemate_and_theoretical()
    print("ok")
