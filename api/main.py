from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware

from api.routers import baselines, study, users
from api.schemas import HealthResponse

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

app = FastAPI(
    title="Chess Wrapped Analytics API",
    version="1.0.0",
    description=(
        "Thin VPC: peer baselines, opening explorer/masters, and "
        "username/email registry. User games and analytics bulk live on device."
    ),
)

app.add_middleware(GZipMiddleware, minimum_size=500, compresslevel=6)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router, prefix="/api/v1")
app.include_router(baselines.router, prefix="/api/v1")
app.include_router(study.router, prefix="/api/v1")


@app.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(status="ok")
