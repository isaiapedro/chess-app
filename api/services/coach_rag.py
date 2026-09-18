from __future__ import annotations

import os
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any

DEFAULT_COACH_ROOT = Path(__file__).resolve().parents[4] / "experiments" / "chess-coach"


def _coach_root() -> Path:
    env = os.getenv("CHESS_COACH_ROOT")
    if env:
        return Path(env).resolve()
    return DEFAULT_COACH_ROOT.resolve()


def _ensure_coach_on_path() -> Path:
    root = _coach_root()
    src = root / "src"
    if src.is_dir() and str(src) not in sys.path:
        sys.path.insert(0, str(src))
    return root


@lru_cache(maxsize=1)
def _load_coach_config() -> dict[str, Any]:
    root = _ensure_coach_on_path()
    from chess_coach.config import load_config

    cfg_path = root / "configs" / "default.yaml"
    return load_config(cfg_path if cfg_path.is_file() else None)


def retrieve_coach_nuggets(
    *,
    fen: str,
    themes: list[str] | None = None,
    phase: str | None = None,
    san: str | None = None,
    best_san: str | None = None,
    eco: str | None = None,
    opening: str | None = None,
    want_count: int = 2,
) -> list[dict[str, Any]]:
    """
    Soft-fail vector retrieve from chess-coach Chroma.
    Returns [] if coach root / Ollama / collections unavailable.
    """
    if not fen or not fen.strip():
        return []
    try:
        _ensure_coach_on_path()
        from chess_coach.rag.retrieve import passages_to_nuggets, retrieve_for_position

        config = _load_coach_config()
        passages = retrieve_for_position(
            fen.strip(),
            config,
            themes=themes or [],
            phase=phase,
            san=san or "",
            best_san=best_san or "",
            eco=eco or "",
            opening=opening or "",
            want_count=max(1, min(int(want_count or 2), 4)),
        )
        return passages_to_nuggets(passages)
    except Exception:
        return []
