from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field


class DocumentEditSchema(BaseModel):
    target_text: str = Field(..., description="Exact text to find in the document")
    new_text: str = Field(..., description="Replacement text")
    comment: Optional[str] = Field(None, description="Comment bubble text")


class ReviewActionType(str, Enum):
    ACCEPT = "ACCEPT"
    REJECT = "REJECT"
    REPLY = "REPLY"


class ReviewActionSchema(BaseModel):
    action: ReviewActionType
    target_id: str = Field(..., description="Target ID (e.g. 'Chg:1' or 'Com:5')")
    text: Optional[str] = Field(None, description="Reply body text")
    comment: Optional[str] = Field(None, description="Rationale for accept/reject")


class ReadDocxResponse(BaseModel):
    text: str
    filename: str


class ProcessBatchRequest(BaseModel):
    author_name: str = Field(..., min_length=1)
    edits: Optional[List[DocumentEditSchema]] = None
    actions: Optional[List[ReviewActionSchema]] = None


class BatchSummary(BaseModel):
    applied_edits: int
    skipped_edits: int
    applied_actions: int
    skipped_actions: int


class ApplyEditsMarkdownRequest(BaseModel):
    edits: List[DocumentEditSchema]
    highlight_only: bool = False
    include_index: bool = False


class ApplyEditsMarkdownResponse(BaseModel):
    markdown: str


class DiffResponse(BaseModel):
    diff: str
    has_differences: bool


class ErrorResponse(BaseModel):
    detail: str
    errors: Optional[List[str]] = None
