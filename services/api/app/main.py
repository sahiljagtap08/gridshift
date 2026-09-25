from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import clusters, events, policies
from app.core.config import get_settings
from app.core.deps import get_orchestrator
from app.core.seed import seed_demo
from app.core.store import get_store


@asynccontextmanager
async def lifespan(app: FastAPI):
    seed_demo(get_store())
    orch = get_orchestrator()
    orch.start_telemetry()
    yield
    await orch.stop()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="GridShift API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok", "foundry_configured": settings.foundry_configured}

    app.include_router(clusters.router, prefix="/api/v1")
    app.include_router(events.router, prefix="/api/v1")
    app.include_router(policies.router, prefix="/api/v1")
    return app


app = create_app()
