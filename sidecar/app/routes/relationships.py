"""
POST /extract-relationships — Extract entities and typed relationships
from text chunks using an OpenAI-compatible LLM.
"""

import asyncio
import os
import re
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.models.llm import call_llm, parse_llm_json

router = APIRouter()

VALID_ENTITY_TYPES = {"PERSON", "ORGANIZATION", "LOCATION", "PRODUCT", "EVENT", "OTHER"}
REL_TYPE_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")

SYSTEM_PROMPT = """You are an entity and relationship extraction engine.
Given a text chunk, extract all named entities and the semantic relationships between them.

Output ONLY valid JSON with this exact shape (no extra text):
{
  "entities": [
    {"name": "<entity name>", "type": "<PERSON|ORGANIZATION|LOCATION|PRODUCT|EVENT|OTHER>"}
  ],
  "relationships": [
    {"source": "<entity name>", "target": "<entity name>", "type": "<RELATIONSHIP_TYPE>", "detail": "<brief description>"}
  ]
}

Rules:
- Entity "type" must be one of: PERSON, ORGANIZATION, LOCATION, PRODUCT, EVENT, OTHER
- Relationship "type" must be SCREAMING_SNAKE_CASE (uppercase letters, digits, underscores, starting with a letter). Examples: CEO_OF, ACQUIRED, LOCATED_IN, WORKS_FOR
- Relationship "source" and "target" must exactly match an entity "name" from the entities list
- "detail" is a brief sentence describing the relationship
- Output raw JSON only — no markdown fences, no explanation"""

MAX_CONCURRENCY = 3


# ------------------------------------------------------------------
# Pydantic models (matching Zod contracts)
# ------------------------------------------------------------------

class ExtractionEntity(BaseModel):
    name: str = Field(..., min_length=1)
    type: Literal["PERSON", "ORGANIZATION", "LOCATION", "PRODUCT", "EVENT", "OTHER"]


class ExtractionRelationship(BaseModel):
    source: str = Field(..., min_length=1)
    target: str = Field(..., min_length=1)
    type: str = Field(..., min_length=1, pattern=r"^[A-Z][A-Z0-9_]*$")
    detail: str


class ExtractionChunkResult(BaseModel):
    text: str
    entities: list[ExtractionEntity]
    relationships: list[ExtractionRelationship]
    dropped_relationships: list[ExtractionRelationship]


class ExtractRelationshipsRequest(BaseModel):
    chunks: list[str] = Field(
        default=..., description="Text chunks to extract relationships from"
    )


class ExtractRelationshipsResponse(BaseModel):
    results: list[ExtractionChunkResult]
    total_entities: int
    total_relationships: int
    total_dropped: int


# ------------------------------------------------------------------
# Empty response helper
# ------------------------------------------------------------------

EMPTY_RESPONSE = ExtractRelationshipsResponse(
    results=[],
    total_entities=0,
    total_relationships=0,
    total_dropped=0,
)


# ------------------------------------------------------------------
# Per-chunk processing
# ------------------------------------------------------------------

async def _process_chunk(
    chunk: str,
    base_url: str,
    model: str,
    semaphore: asyncio.Semaphore,
) -> ExtractionChunkResult:
    """Call the LLM for one chunk, parse, and validate relationships."""
    async with semaphore:
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": chunk},
        ]

        raw_content = await call_llm(base_url, model, messages)
        parsed = parse_llm_json(raw_content)

    raw_entities = parsed.get("entities", [])
    raw_relationships = parsed.get("relationships", [])

    # Validate entities
    entities: list[ExtractionEntity] = []
    for ent in raw_entities:
        name = ent.get("name", "").strip() if isinstance(ent, dict) else ""
        etype = ent.get("type", "").strip().upper() if isinstance(ent, dict) else ""
        if name and etype in VALID_ENTITY_TYPES:
            entities.append(ExtractionEntity(name=name, type=etype))

    entity_names = {e.name for e in entities}

    # Validate relationships — split into valid vs. dropped
    relationships: list[ExtractionRelationship] = []
    dropped: list[ExtractionRelationship] = []

    for rel in raw_relationships:
        if not isinstance(rel, dict):
            continue
        source = rel.get("source", "").strip()
        target = rel.get("target", "").strip()
        rtype = rel.get("type", "").strip()
        detail = rel.get("detail", "")

        if not source or not target or not rtype:
            continue

        if not REL_TYPE_RE.match(rtype):
            # Try to fix common patterns (e.g. "ceo_of" → "CEO_OF")
            fixed = rtype.upper().replace(" ", "_").replace("-", "_")
            if REL_TYPE_RE.match(fixed):
                rtype = fixed
            else:
                continue

        relationship = ExtractionRelationship(
            source=source, target=target, type=rtype, detail=detail
        )

        if source in entity_names and target in entity_names:
            relationships.append(relationship)
        else:
            dropped.append(relationship)

    return ExtractionChunkResult(
        text=chunk,
        entities=entities,
        relationships=relationships,
        dropped_relationships=dropped,
    )


# ------------------------------------------------------------------
# Route
# ------------------------------------------------------------------

@router.post("/extract-relationships", response_model=ExtractRelationshipsResponse)
async def extract_relationships(req: ExtractRelationshipsRequest):
    """Extract entities and relationships from text chunks via LLM."""
    base_url = os.environ.get("EXTRACTION_LLM_BASE_URL", "")
    model = os.environ.get("EXTRACTION_LLM_MODEL", "")

    if not base_url:
        return EMPTY_RESPONSE

    if not req.chunks:
        return EMPTY_RESPONSE

    semaphore = asyncio.Semaphore(MAX_CONCURRENCY)
    tasks = [
        _process_chunk(chunk, base_url, model, semaphore)
        for chunk in req.chunks
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    # Replace any failed tasks with empty results
    clean_results: list[ExtractionChunkResult] = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            clean_results.append(
                ExtractionChunkResult(
                    text=req.chunks[i],
                    entities=[],
                    relationships=[],
                    dropped_relationships=[],
                )
            )
        else:
            clean_results.append(result)

    total_entities = sum(len(r.entities) for r in clean_results)
    total_relationships = sum(len(r.relationships) for r in clean_results)
    total_dropped = sum(len(r.dropped_relationships) for r in clean_results)

    return ExtractRelationshipsResponse(
        results=clean_results,
        total_entities=total_entities,
        total_relationships=total_relationships,
        total_dropped=total_dropped,
    )
