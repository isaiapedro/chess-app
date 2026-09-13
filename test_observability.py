"""Dependency-free checks for the API's privacy-safe request correlation."""

from __future__ import annotations

import asyncio

from starlette.requests import Request
from starlette.responses import Response

from api.observability import REQUEST_ID_HEADER, log_request, request_id_from


def request(headers: list[tuple[bytes, bytes]] | None = None) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/health",
            "headers": headers or [],
        }
    )


def test_request_id_policy() -> None:
    assert request_id_from(request([(b"x-request-id", b"audit-123")])) == "audit-123"
    generated = request_id_from(request([(b"x-request-id", "non-ascii-\u00e9".encode())]))
    assert len(generated) == 32
    assert request_id_from(request([(b"x-request-id", b"x" * 65)])) != "x" * 65


def test_response_carries_correlation_id() -> None:
    async def next_response(_: Request) -> Response:
        return Response("ok", status_code=200)

    response = asyncio.run(
        log_request(
            request([(b"x-request-id", b"audit-123")]),
            next_response,
        )
    )
    assert response.status_code == 200
    assert response.headers[REQUEST_ID_HEADER] == "audit-123"


if __name__ == "__main__":
    test_request_id_policy()
    test_response_carries_correlation_id()
    print("ok")
