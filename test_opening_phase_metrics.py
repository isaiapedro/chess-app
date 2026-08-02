from __future__ import annotations

from opening_phase_metrics import (
    aggregate_opening_metrics,
    move_accuracy_pct,
    opening_phase_end_fullmove,
    analyze_opening_game,
)


def test_phase_end() -> None:
    assert opening_phase_end_fullmove(None) == 15
    assert opening_phase_end_fullmove(8) == 12
    assert opening_phase_end_fullmove(14) == 14
    assert opening_phase_end_fullmove(20) == 20


def test_accuracy_formula() -> None:
    perfect = move_accuracy_pct(50.0, 50.0)
    assert 95.0 <= perfect <= 100.0
    drop = move_accuracy_pct(70.0, 40.0)
    assert drop < perfect
    gain = move_accuracy_pct(40.0, 70.0)
    assert gain > perfect
    assert 0.0 <= drop <= 100.0


def test_castle_and_uncastled() -> None:
    pgn = """[Event "?"]
[Site "?"]
[Date "2024.01.01"]
[Round "?"]
[White "A"]
[Black "B"]
[Result "1-0"]
[ECO "C20"]
[Opening "King Pawn"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 5. d3 O-O 6. Nc3 d6 1-0
"""
    white = analyze_opening_game(pgn, "white")
    assert white is not None
    assert white["uncastled"] is False
    assert white["opening_castle_fullmove"] == 4.0
    assert white["phase_end_fullmove"] == 12.0

    no_castle = """[Event "?"]
[Site "?"]
[Date "2024.01.01"]
[Round "?"]
[White "A"]
[Black "B"]
[Result "1-0"]
[ECO "A00"]
[Opening "Test"]

1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0
"""
    row = analyze_opening_game(no_castle, "white")
    assert row is not None
    assert row["uncastled"] is True
    assert row["opening_castle_fullmove"] is None

    agg = aggregate_opening_metrics([white, row])
    assert agg["castled_games"] == 1
    assert agg["opening_castle_fullmove"] == 4.0
    assert agg["opening_uncastled_rate_pct"] == 50.0
    assert agg["opening_minors_developed_by_10"] is not None


def test_late_castle_uncapped() -> None:
    import chess
    import chess.pgn
    import io

    board = chess.Board()
    moves = [
        "e4",
        "e5",
        "Nf3",
        "Nc6",
        "Bc4",
        "Bc5",
        "d3",
        "Nf6",
        "Nc3",
        "d6",
        "Bg5",
        "h6",
        "Bh4",
        "a6",
        "a3",
        "Ba7",
        "Ba2",
        "Be6",
        "Qe2",
        "Qe7",
        "Rd1",
        "Rd8",
        "h3",
        "O-O",
        "Bb1",
        "Rfe8",
        "Ba2",
        "Bb8",
        "Bb1",
        "Ba7",
        "Ba2",
        "Bb8",
        "O-O",
    ]
    for san in moves:
        board.push_san(san)
    game = chess.pgn.Game.from_board(board)
    game.headers["White"] = "A"
    game.headers["Black"] = "B"
    exporter = chess.pgn.StringExporter(headers=True, variations=False, comments=False)
    pgn = game.accept(exporter)
    row = analyze_opening_game(pgn, "white")
    assert row is not None
    assert row["opening_castle_fullmove"] is not None
    assert row["opening_castle_fullmove"] > 15


if __name__ == "__main__":
    test_phase_end()
    test_accuracy_formula()
    test_castle_and_uncastled()
    test_late_castle_uncapped()
    print("ok")
