from datetime import date, datetime
import re
from typing import Any

import numpy as np
import pandas as pd

from load_data import moves_from_pgn

STUDY_WIRE_COLUMNS = [
    "id",
    "created_at",
    "speed",
    "user_color",
    "user_rating",
    "opponent_name",
    "result",
    "opening_name",
    "opening_eco",
    "moves_str",
    "pgn_str",
    "time_control",
]

_CLK_COMMENT_RE = re.compile(
    r"\s*\{\s*\[%clk\s+[^\]]*\]\s*\}",
    flags=re.IGNORECASE,
)
_CLK_INLINE_RE = re.compile(r"\[%clk\s+[^\]]*\]", flags=re.IGNORECASE)
_TAG_LINE_RE = re.compile(r"^\[[^\]]+\]\s*$", flags=re.MULTILINE)


def to_json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, dict):
        return {str(k): to_json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_json_safe(v) for v in value]
    if isinstance(value, pd.DataFrame):
        return [to_json_safe(row) for row in value.to_dict(orient="records")]
    if isinstance(value, pd.Series):
        return to_json_safe(value.to_dict())
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        if np.isnan(value):
            return None
        return float(value)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, float) and np.isnan(value):
        return None
    if hasattr(value, "item") and callable(value.item):
        try:
            return to_json_safe(value.item())
        except (ValueError, AttributeError):
            pass
    return value


def dataframe_to_records(
    df: pd.DataFrame, drop_columns: list[str] | None = None
) -> list[dict]:
    if df.empty:
        return []
    out = df.copy()
    if drop_columns:
        out = out.drop(columns=drop_columns, errors="ignore")
    return to_json_safe(out.to_dict(orient="records"))


def slim_pgn_for_study(pgn_str: str) -> str:
    if not pgn_str:
        return ""
    text = _CLK_COMMENT_RE.sub("", str(pgn_str))
    text = _CLK_INLINE_RE.sub("", text)
    text = _TAG_LINE_RE.sub("", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def study_games_records(
    df: pd.DataFrame, include_moves: bool = False
) -> list[dict]:
    if df.empty:
        return []

    keep = [c for c in STUDY_WIRE_COLUMNS if c in df.columns]
    work = df.loc[:, keep].copy()

    if not include_moves:
        work = work.drop(columns=["moves_str", "pgn_str"], errors="ignore")
        return to_json_safe(work.to_dict(orient="records"))

    records = to_json_safe(work.to_dict(orient="records"))
    slim: list[dict] = []
    for row in records:
        moves = str(row.get("moves_str") or "").strip()
        pgn = str(row.get("pgn_str") or "").strip()
        if not moves and pgn:
            moves = moves_from_pgn(pgn)
        if moves:
            row["moves_str"] = moves
            row.pop("pgn_str", None)
        elif pgn:
            row.pop("moves_str", None)
            row["pgn_str"] = slim_pgn_for_study(pgn)
        else:
            row.pop("moves_str", None)
            row.pop("pgn_str", None)
        slim.append(row)
    return slim
