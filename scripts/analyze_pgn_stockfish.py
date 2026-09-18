#!/usr/bin/env python3
import argparse
import io
import sys
from pathlib import Path

import chess
import chess.engine
import chess.pgn

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENGINE = ROOT / "bin" / "stockfish" / "stockfish-ubuntu-x86-64-avx2"


def score_to_white_cp(score: chess.engine.PovScore) -> float | None:
    white = score.white()
    if white.is_mate():
        mate = white.mate()
        if mate is None:
            return None
        return 100000.0 if mate > 0 else -100000.0
    cp = white.score(mate_score=100000)
    return None if cp is None else float(cp)


def fmt_score(score: chess.engine.PovScore) -> str:
    white = score.white()
    if white.is_mate():
        mate = white.mate()
        return f"M{mate:+d}" if mate is not None else "M?"
    cp = white.score()
    if cp is None:
        return "?"
    return f"{cp / 100:+.2f}"


def load_game(pgn_text: str) -> chess.pgn.Game:
    game = chess.pgn.read_game(io.StringIO(pgn_text.strip()))
    if game is None:
        raise SystemExit("Could not parse PGN.")
    return game


def analyze_game(
    game: chess.pgn.Game,
    engine_path: Path,
    depth: int,
    threads: int,
    hash_mb: int,
    multipv: int,
) -> None:
    if not engine_path.exists():
        raise SystemExit(
            f"Engine not found: {engine_path}\n"
            "Download Stockfish 18 into bin/ or pass --engine PATH"
        )

    engine = chess.engine.SimpleEngine.popen_uci(str(engine_path))
    try:
        engine.configure(
            {
                "Threads": threads,
                "Hash": hash_mb,
            }
        )

        board = game.board()
        white = game.headers.get("White", "White")
        black = game.headers.get("Black", "Black")
        result = game.headers.get("Result", "*")
        print(f"{white} vs {black}  ({result})")
        print(
            f"Engine={engine_path.name}  Threads={threads}  "
            f"Hash={hash_mb}  MultiPV={multipv}  Depth={depth}"
        )
        print("-" * 88)
        print(
            f"{'Ply':>4}  {'Move':<8}  {'Best':<8}  "
            f"{'BestEval':>9}  {'PlayedEval':>10}  {'DeltaCP':>8}  {'Side'}"
        )
        print("-" * 88)

        ply = 0
        for node in game.mainline():
            ply += 1
            played = node.move
            played_san = board.san(played)
            side = "White" if board.turn == chess.WHITE else "Black"

            limit = chess.engine.Limit(depth=depth)
            best_info = engine.analyse(board, limit, multipv=multipv)
            if isinstance(best_info, list):
                best_info = best_info[0]

            best_move = best_info.get("pv", [None])[0]
            best_score = best_info["score"]
            best_san = board.san(best_move) if best_move else "?"

            if best_move == played:
                played_score = best_score
            else:
                played_info = engine.analyse(
                    board, limit, root_moves=[played]
                )
                if isinstance(played_info, list):
                    played_info = played_info[0]
                played_score = played_info["score"]

            best_cp = score_to_white_cp(best_score)
            played_cp = score_to_white_cp(played_score)
            if best_cp is None or played_cp is None:
                delta = None
            elif board.turn == chess.WHITE:
                delta = best_cp - played_cp
            else:
                delta = played_cp - best_cp

            delta_s = "?" if delta is None else f"{delta:.0f}"
            print(
                f"{ply:4d}  {played_san:<8}  {best_san:<8}  "
                f"{fmt_score(best_score):>9}  {fmt_score(played_score):>10}  "
                f"{delta_s:>8}  {side}"
            )

            board.push(played)
    finally:
        engine.quit()


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Paste/analyze one PGN with Stockfish: move-by-move "
            "best vs played eval at fixed depth (no movetime)."
        )
    )
    parser.add_argument(
        "pgn_file",
        nargs="?",
        help="PGN file path. Omit to paste PGN on stdin (end with Ctrl-D).",
    )
    parser.add_argument(
        "--engine",
        type=Path,
        default=DEFAULT_ENGINE,
        help=f"Stockfish binary (default: {DEFAULT_ENGINE})",
    )
    parser.add_argument("--depth", type=int, default=14)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--hash", type=int, default=32)
    parser.add_argument("--multipv", type=int, default=1)
    args = parser.parse_args()

    if args.pgn_file:
        pgn_text = Path(args.pgn_file).read_text(encoding="utf-8")
    else:
        if sys.stdin.isatty():
            print(
                "Paste full PGN, then Ctrl-D (Linux/macOS) or Ctrl-Z Enter (Windows):",
                file=sys.stderr,
            )
        pgn_text = sys.stdin.read()

    if not pgn_text.strip():
        raise SystemExit("Empty PGN.")

    game = load_game(pgn_text)
    analyze_game(
        game,
        engine_path=args.engine,
        depth=args.depth,
        threads=args.threads,
        hash_mb=args.hash,
        multipv=args.multipv,
    )


if __name__ == "__main__":
    main()
