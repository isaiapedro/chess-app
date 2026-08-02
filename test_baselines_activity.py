from __future__ import annotations

from baselines import (
    ACTIVITY_METRIC_KEYS,
    accumulate_player_activity,
    days_in_source_month,
    player_activity_from_rows,
    player_activity_metric_fields,
    should_sample_player_activity,
)


def test_days_in_source_month() -> None:
    assert days_in_source_month("lichess_db_standard_rated_2026-07") == 31
    assert days_in_source_month("2026-02") == 28
    assert days_in_source_month("unknown") == 30


def test_player_activity_month_week_day() -> None:
    rows = [
        {
            "username": "alice",
            "speed": "blitz",
            "move_count": 40,
        },
        {
            "username": "alice",
            "speed": "blitz",
            "move_count": 40,
        },
        {
            "username": "bob",
            "speed": "blitz",
            "move_count": 40,
        },
    ]
    by_user = player_activity_from_rows(rows, hash_sample=False)
    fields = player_activity_metric_fields(
        by_user, "lichess_db_standard_rated_2026-07"
    )
    assert fields["players_n"] == 2
    games_m = fields["avg_games_per_player_month"]
    assert isinstance(games_m, dict)
    assert games_m["mean"] == 1.5
    assert games_m["p50"] is not None
    games_d = fields["avg_games_per_player_day"]
    assert isinstance(games_d, dict)
    assert games_d["mean"] == round(1.5 / 31, 3)
    games_w = fields["avg_games_per_player_week"]
    assert isinstance(games_w, dict)
    assert games_w["mean"] == round(1.5 / (31 / 7), 2)
    secs_m = fields["avg_est_seconds_per_player_month"]
    assert isinstance(secs_m, dict)
    assert secs_m["mean"] == round(((40 * 8) + (40 * 8) + (40 * 8)) / 2, 1)
    for key in ACTIVITY_METRIC_KEYS:
        dist = fields[key]
        assert isinstance(dist, dict)
        assert dist["mean"] is not None


def test_hash_sample_accumulate() -> None:
    by_user: dict[str, list[float]] = {}
    tracked = 0
    skipped = 0
    for i in range(320):
        name = f"player_{i}"
        row = {"username": name, "speed": "bullet", "move_count": 20}
        before = len(by_user)
        accumulate_player_activity(by_user, row, sample_mod=32)
        if len(by_user) > before:
            tracked += 1
            assert should_sample_player_activity(name, 32)
        else:
            skipped += 1
    assert tracked > 0
    assert skipped > 0
    assert tracked + skipped == 320


if __name__ == "__main__":
    test_days_in_source_month()
    test_player_activity_month_week_day()
    test_hash_sample_accumulate()
    print("ok")
