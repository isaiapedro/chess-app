from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from typing import Literal

from cache import CACHE_BASE, atomic_write_json, cache_file_lock

Platform = Literal["chesscom", "lichess"]

USERS_DIR = CACHE_BASE / "users"
REGISTRY_PATH = USERS_DIR / "registry.json"

_lock = threading.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _read_registry() -> dict:
    USERS_DIR.mkdir(parents=True, exist_ok=True)
    if not REGISTRY_PATH.exists():
        return {"users": []}
    try:
        with open(REGISTRY_PATH, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if not isinstance(data, dict):
            return {"users": []}
        users = data.get("users")
        if not isinstance(users, list):
            return {"users": []}
        return {"users": users}
    except (OSError, ValueError):
        return {"users": []}


def _write_registry(payload: dict) -> None:
    USERS_DIR.mkdir(parents=True, exist_ok=True)
    with cache_file_lock(REGISTRY_PATH):
        atomic_write_json(REGISTRY_PATH, payload)


def upsert_user(
    *,
    platform: Platform,
    username: str,
    email: str,
) -> dict:
    cleaned_user = username.strip()
    cleaned_email = email.strip()
    if not cleaned_user:
        raise ValueError("username is required")
    if not cleaned_email or "@" not in cleaned_email:
        raise ValueError("a valid email is required")

    key = f"{platform}|{cleaned_user.lower()}"
    with _lock:
        registry = _read_registry()
        users = list(registry.get("users") or [])
        found = False
        for row in users:
            row_key = (
                f"{row.get('platform')}|"
                f"{str(row.get('username') or '').lower()}"
            )
            if row_key == key:
                row["username"] = cleaned_user
                row["email"] = cleaned_email
                row["platform"] = platform
                row["updated_at"] = _now_iso()
                found = True
                break
        if not found:
            users.append(
                {
                    "platform": platform,
                    "username": cleaned_user,
                    "email": cleaned_email,
                    "created_at": _now_iso(),
                    "updated_at": _now_iso(),
                }
            )
        registry["users"] = users
        _write_registry(registry)
        return next(
            row
            for row in users
            if (
                f"{row.get('platform')}|"
                f"{str(row.get('username') or '').lower()}"
            )
            == key
        )


def list_users() -> list[dict]:
    with _lock:
        return list(_read_registry().get("users") or [])
