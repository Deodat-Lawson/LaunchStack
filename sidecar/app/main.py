"""
FastAPI Sidecar — The Muscle
Provides /embed, /rerank, and /extract-entities endpoints
powered by local ML models (sentence-transformers, cross-encoders).
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.models.embedder import Embedder
from app.models.reranker import Reranker
from app.models.ner import EntityExtractor
from app.routes.embed import router as embed_router
from app.routes.rerank import router as rerank_router
from app.routes.entities import router as entities_router


# ---------------------------------------------------------------------------
# Lifespan — warm up models once at startup
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load heavy ML models once and share them for the app lifetime."""
    app.state.embedder = Embedder()
    app.state.reranker = Reranker()
    app.state.entity_extractor = EntityExtractor()

    print("[Sidecar] Models loaded — ready to serve.")
    yield
    print("[Sidecar] Shutting down.")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Launchstack Sidecar",
    description="Local ML compute for embedding, reranking, and entity extraction.",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(embed_router)
app.include_router(rerank_router)
app.include_router(entities_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
