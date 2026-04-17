from typing import List, Literal, Optional
from pydantic import BaseModel, Field


class ParseRequest(BaseModel):
    url: str = Field(..., description="HTTP(S) URL the worker can fetch")
    mime: Optional[str] = None
    filename: Optional[str] = None


class ExtractedTable(BaseModel):
    rows: List[List[str]] = Field(default_factory=list)
    markdown: str = ""
    rowCount: int = 0
    columnCount: int = 0


class PageContent(BaseModel):
    pageNumber: int
    textBlocks: List[str] = Field(default_factory=list)
    tables: List[ExtractedTable] = Field(default_factory=list)


class ParseMetadata(BaseModel):
    totalPages: int
    provider: Literal["MARKER", "DOCLING"]
    processingTimeMs: int
    confidenceScore: Optional[float] = None


class ParseResponse(BaseModel):
    pages: List[PageContent]
    metadata: ParseMetadata
