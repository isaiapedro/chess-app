"""Minimal, privacy-safe HTTP observability for the thin API.

The API deliberately does not retain player games or analytics. Its operational
logs follow the same boundary: they record request mechanics only, never a
request body, query string, credential, username, email, PGN, or chess
position.
"""

from __future__ import annotations

import json
import logging
import sys
import time
from collections.abc import Awaitable, Callable
from uuid import uuid4

from fastapi import Request, Response

REQUEST_ID_HEADER = "X-Request-ID"
_MAX_REQUEST_ID_LENGTH = 64


class JsonFormatter(logging.Formatter):
    """Render the fixed, body-free request fields as one JSON event."""

    def format(self, record: logging.LogRecord) -> str:
        event = {
            "level": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
        }
        for field in ("request_id", "method", "path", "status", "duration_ms"):
            value = getattr(record, field, None)
            if value is not None:
                event[field] = value
        return json.dumps(event, separators=(",", ":"), sort_keys=True)


def configure_observability() -> None:
    """Configure this application's logger without changing root log policy."""

    logger = logging.getLogger("chess_wrapped.api")
    if logger.handlers:
        return
    # Container and process supervisors collect stdout as the application
    # event stream. Keeping request events there also leaves stderr available
    # for real interpreter/runtime diagnostics.
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False


def request_id_from(request: Request) -> str:
    """Accept only a short safe correlation ID; otherwise issue a new one."""

    candidate = request.headers.get(REQUEST_ID_HEADER, "").strip()
    if candidate and len(candidate) <= _MAX_REQUEST_ID_LENGTH and candidate.isascii():
        return candidate
    return uuid4().hex


async def log_request(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    request_id = request_id_from(request)
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = round((time.perf_counter() - started) * 1000, 1)
        logging.getLogger("chess_wrapped.api").exception(
            "request_failed",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status": 500,
                "duration_ms": duration_ms,
            },
        )
        raise

    duration_ms = round((time.perf_counter() - started) * 1000, 1)
    response.headers[REQUEST_ID_HEADER] = request_id
    logging.getLogger("chess_wrapped.api").info(
        "request_completed",
        extra={
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "status": response.status_code,
            "duration_ms": duration_ms,
        },
    )
    return response
