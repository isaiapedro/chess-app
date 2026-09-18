import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware

from api.routers import baselines, coach, study, users
from api.schemas import HealthResponse
from api.observability import configure_observability, log_request

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def cors_origins() -> list[str]:
    """Return explicitly approved browser origins; native clients need no CORS."""

    raw = os.getenv("CHESS_ALLOWED_ORIGINS", "")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]

app = FastAPI(
    title="Chess Wrapped Analytics API",
    version="1.0.0",
    description=(
        "Thin VPC: peer baselines, opening explorer/masters, coach RAG retrieve, "
        "and username/email registry. User games and analytics bulk live on device."
    ),
)
configure_observability()
app.middleware("http")(log_request)

app.add_middleware(GZipMiddleware, minimum_size=500, compresslevel=6)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Request-ID"],
)

app.include_router(users.router, prefix="/api/v1")
app.include_router(baselines.router, prefix="/api/v1")
app.include_router(study.router, prefix="/api/v1")
app.include_router(coach.router, prefix="/api/v1")


@app.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(status="ok")
