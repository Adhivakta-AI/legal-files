from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import db
from app.schemas import HealthResponse, SearchRequest, SearchResponse
from app.search import hybrid_search


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect(get_settings())
    try:
        yield
    finally:
        await db.close()


settings = get_settings()
app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.post("/api/search", response_model=SearchResponse)
async def search(request: SearchRequest) -> SearchResponse:
    async for conn in db.acquire():
        results = await hybrid_search(conn, request)
        return SearchResponse(
            query=request.query,
            limit=request.limit,
            year_from=request.year_from,
            year_to=request.year_to,
            results=results,
        )
    raise RuntimeError("Database connection was not available")
