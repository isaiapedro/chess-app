from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routers import games, stats, study
from api.schemas import HealthResponse

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

app = FastAPI(
    title="Chess Wrapped Analytics API",
    version="1.0.0",
    description="REST API for chess game analytics (Recap / Insights / Study).",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(games.router, prefix="/api/v1")
app.include_router(stats.router, prefix="/api/v1")
app.include_router(study.router, prefix="/api/v1")


@app.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(status="ok")
