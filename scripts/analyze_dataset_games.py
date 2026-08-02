#!/usr/bin/env python3
import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from load_data import load_user_data
from style_metrics import DEFAULT_ENGINE, calculate_style_metrics


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Analyze last N dataset games with Stockfish + board metrics."
    )
    parser.add_argument("--username", default="pedroisaia")
    parser.add_argument(
        "--platform", default="chesscom", choices=["chesscom", "lichess"]
    )
    parser.add_argument("--timeframe", default="1 month")
    parser.add_argument("--n", type=int, default=10)
    parser.add_argument("--engine", type=Path, default=DEFAULT_ENGINE)
    parser.add_argument("--depth", type=int, default=14)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--hash", type=int, default=32)
    args = parser.parse_args()

    df = load_user_data(args.username, args.timeframe, platform=args.platform)
    if df.empty:
        raise SystemExit("No games loaded.")

    def _progress(i, total, game_id):
        print(f"[{i}/{total}] analyzing {game_id}…", flush=True)

    t0 = time.time()
    style = calculate_style_metrics(
        df,
        n=args.n,
        engine_path=args.engine,
        depth=args.depth,
        threads=args.threads,
        hash_mb=args.hash,
        progress_callback=_progress,
    )
    initiative = style["initiative"]
    attacking = style["attacking"]
    print("=" * 72)
    print(f"Games: {style['games']}  Win%: {style['win_rate']}  "
          f"Time: {style['avg_time_per_move_s']}s/move")
    print("- Initiative & Maneuver")
    print(f"  volatility={initiative.get('avg_eval_volatility_cp')}cp  "
          f"sac={initiative.get('sacrifice_rate_pct')}%  "
          f"flank={initiative.get('early_flank_rate_pct')}%  "
          f"egConv={initiative.get('endgame_conversion_rate_pct')}  "
          f"earlyTrades={initiative.get('early_trade_rate_pct')}%")
    print("- Attacking & Defending")
    print(f"  threats={attacking.get('avg_higher_value_threats')}  "
          f"escapes={attacking.get('avg_threat_escapes')}  "
          f"nearEnemyK={attacking.get('avg_trades_near_enemy_king')}  "
          f"nearUserK={attacking.get('avg_trades_near_user_king')}  "
          f"oppTerr={attacking.get('territory_opp_pct')}%  "
          f"fwd/back={attacking.get('forward_move_pct')}/"
          f"{attacking.get('backward_move_pct')}")
    creativity = style["creativity"]
    print("- Creativity")
    print(f"  drawishless={creativity.get('drawishless_rate_pct')}%  "
          f"declinedRecap={creativity.get('declined_recapture_rate_pct')}%  "
          f"critTime={creativity.get('avg_critical_time_s')}s  "
          f"critN={creativity.get('critical_positions')}")
    print(f"Wall time: {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
