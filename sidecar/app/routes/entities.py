"""
POST /extract-entities — Extract named entities from text chunks.
Used by the Graph RAG pipeline to build the knowledge graph.
"""

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field


router = APIRouter()


# ------------------------------------------------------------------
# Response models — base (backward-compatible)
# ------------------------------------------------------------------

class Entity(BaseModel):
    text: str
    label: str
    score: float


class ChunkEntities(BaseModel):
    text: str
    entities: list[Entity]


class ExtractEntitiesResponse(BaseModel):
    results: list[ChunkEntities]
    total_entities: int


# ------------------------------------------------------------------
# Response models — enhanced (with 768-dim embeddings)
# ------------------------------------------------------------------

class EntityWithEmbedding(BaseModel):
    text: str
    label: str
    score: float
    embedding: list[float] = Field(..., min_length=768, max_length=768)


class ChunkEntitiesEnhanced(BaseModel):
    text: str
    entities: list[EntityWithEmbedding]


class ExtractEntitiesEnhancedResponse(BaseModel):
    results: list[ChunkEntitiesEnhanced]
    total_entities: int


# ------------------------------------------------------------------
# Request model
# ------------------------------------------------------------------

class ExtractEntitiesRequest(BaseModel):
    chunks: list[str] = Field(
        default=..., description="Text chunks to extract entities from"
    )


# ------------------------------------------------------------------
# Route
# ------------------------------------------------------------------

@router.post("/extract-entities")
async def extract_entities(
    req: ExtractEntitiesRequest,
    request: Request,
    include_embeddings: bool = Query(False),
):
    """Extract named entities from the provided text chunks."""
    extractor = request.app.state.entity_extractor

    if include_embeddings:
        raw_results = extractor.extract_with_embeddings(req.chunks)
    else:
        raw_results = extractor.extract(req.chunks)

    results = []
    total = 0

    for item in raw_results:
        if include_embeddings:
            entities = [
                EntityWithEmbedding(
                    text=e["text"],
                    label=e["label"],
                    score=e["score"],
                    embedding=e["embedding"],
                )
                for e in item["entities"]
            ]
            total += len(entities)
            results.append(ChunkEntitiesEnhanced(text=item["text"], entities=entities))
        else:
            entities = [
                Entity(text=e["text"], label=e["label"], score=e["score"])
                for e in item["entities"]
            ]
            total += len(entities)
            results.append(ChunkEntities(text=item["text"], entities=entities))

    if include_embeddings:
        return ExtractEntitiesEnhancedResponse(results=results, total_entities=total)

    return ExtractEntitiesResponse(results=results, total_entities=total)
