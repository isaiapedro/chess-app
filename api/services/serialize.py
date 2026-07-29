from datetime import date, datetime
from typing import Any

import numpy as np
import pandas as pd


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
