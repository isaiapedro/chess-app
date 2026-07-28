import argparse
from load_data import load_user_data
from visualizer import render_dashboard


def main():
    parser = argparse.ArgumentParser(
        description="Chess Performance Dashboard CLI"
    )
    parser.add_argument(
        "--username",
        "-u",
        type=str,
        default="isaiapedro",
        help="Chess username to analyze",
    )
    parser.add_argument(
        "--platform",
        "-p",
        type=str,
        default="chesscom",
        choices=["chesscom", "lichess"],
        help="Platform to fetch games from (chesscom or lichess)",
    )
    parser.add_argument(
        "--timeframe",
        "-t",
        type=str,
        default="6 months",
        choices=["1 month", "6 months", "1 year"],
        help="Timeframe window for stats",
    )

    args = parser.parse_args()

    print(
        f"\n🚀 Fetching data from [{args.platform.upper()}] for '{args.username}' ({args.timeframe})..."
    )
    df = load_user_data(args.username, args.timeframe, platform=args.platform)

    if df.empty:
        print("⚠️ No game data found.")
        return

    print(f"✅ Loaded {len(df)} games!")
    print("📊 Rendering dashboard window...")
    render_dashboard(
        df, args.username, f"{args.platform.title()} ({args.timeframe})"
    )


if __name__ == "__main__":
    main()
