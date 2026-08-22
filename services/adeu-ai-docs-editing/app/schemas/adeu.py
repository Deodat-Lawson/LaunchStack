"""
Wire models for the adeu-ai-docs-editing service.

The pre-2.4 shapes (`ReadDocxResponse`, `ProcessBatchRequest`, `BatchSummary`,
`ApplyEditsMarkdownRequest/Response`, `DiffResponse`, `ErrorResponse`) are
frozen against the JSON Schemas generated from `packages/protocol` — see
tests/test_contract.py. Everything added for the editor UI is additive:
existing clients keep validating unchanged.
"""

from enum import Enum
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


# --- object references (ADR-004 §6) -------------------------------------------

class ObjectRef(BaseModel):
    """A document identified by URL rather than uploaded inline.

    Only origins on the service's allow-list are fetchable; see app.objectref.
    Accepting these is what lets a stored document be redlined without three
    extra full-body transfers through the caller.
    """

    url: str = Field(..., min_length=1)
    filename: Optional[str] = None


# --- frozen v1 shapes ---------------------------------------------------------

class DocumentEditSchema(BaseModel):
    target_text: str = Field(..., description="Exact text to find in the document")
    new_text: str = Field(..., description="Replacement text")
    comment: Optional[str] = Field(None, description="Comment bubble text")
    match_mode: Optional[Literal["strict", "first", "all"]] = Field(
        None,
        description=(
            "How to resolve a target that appears more than once. 'strict' "
            "(adeu's default) fails on ambiguity, 'first' takes the first "
            "match, 'all' edits every occurrence."
        ),
    )


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


class BatchSummary(BaseModel):
    applied_edits: int
    skipped_edits: int
    applied_actions: int
    skipped_actions: int


class ApplyEditsMarkdownRequest(BaseModel):
    edits: List[DocumentEditSchema]
    highlight_only: bool = False
    include_index: bool = False
    source: Optional[ObjectRef] = None


class ApplyEditsMarkdownResponse(BaseModel):
    markdown: str


class DiffResponse(BaseModel):
    diff: str
    has_differences: bool


class ErrorResponse(BaseModel):
    detail: str
    errors: Optional[List[str]] = None


# --- review model -------------------------------------------------------------

ReviewItemKind = Literal["insert", "delete", "format", "comment"]


class ReviewItem(BaseModel):
    """One tracked change or comment, addressable by `id` in a review action."""

    id: str = Field(..., description="adeu revision id, e.g. 'Chg:12' or 'Com:5'")
    kind: ReviewItemKind
    author: str
    date: Optional[str] = None
    text: str = Field("", description="Changed text, or the comment body")
    anchor_text: str = Field("", description="Document text the item attaches to")
    paired_with: Optional[str] = Field(
        None,
        description=(
            "Id of the revision this one resolves with. A replacement is a "
            "delete+insert pair: resolving either resolves both, so a UI must "
            "present them as one decision."
        ),
    )
    offset: int = Field(0, description="Character offset in the CriticMarkup text")
    context: str = Field("", description="Short surrounding-text window")


class ReviewItemsResponse(BaseModel):
    filename: str
    items: List[ReviewItem]
    authors: List[str] = Field(
        default_factory=list, description="Distinct authors with pending revisions"
    )
    change_count: int = 0
    comment_count: int = 0


# --- batch processing ---------------------------------------------------------

class EditReport(BaseModel):
    """Per-edit outcome from adeu's `process_batch`.

    Aggregate counts cannot tell a reviewer *which* edit failed; this can.
    Fields mirror adeu's own report keys, with unknown keys preserved so an
    adeu upgrade that adds detail is not silently dropped at the boundary.
    """

    index: Optional[int] = None
    status: Optional[str] = None
    target_text: Optional[str] = None
    new_text: Optional[str] = None
    reason: Optional[str] = None
    occurrences_modified: Optional[int] = None
    heading_path: Optional[str] = None
    page: Optional[int] = None

    model_config = {"extra": "allow"}


class FailedEdit(BaseModel):
    index: Optional[int] = None
    reason: str = ""

    model_config = {"extra": "allow"}


class BatchResult(BaseModel):
    """Full outcome of a batch. `summary` keeps the frozen v1 counts so existing
    callers are unaffected; everything else is new detail."""

    status: str = "ok"
    summary: BatchSummary
    edits: List[EditReport] = Field(default_factory=list)
    failed: List[FailedEdit] = Field(default_factory=list)
    skipped_details: List[str] = Field(default_factory=list)
    occurrences_modified: int = 0
    actions_already_resolved: int = 0
    author_impersonation_warning: Optional[str] = None
    adeu_version: Optional[str] = None


class ProcessBatchRequest(BaseModel):
    author_name: str = Field(..., min_length=1)
    edits: Optional[List[DocumentEditSchema]] = None
    actions: Optional[List[ReviewActionSchema]] = None
    partial: bool = Field(
        False,
        description=(
            "Apply the edits that validate and report the rest, instead of "
            "rejecting the whole batch. Off by default: an all-or-nothing "
            "batch is the safer default for an automated caller."
        ),
    )
    self_contained: bool = Field(
        True,
        description=(
            "Expand ambiguous targets with surrounding context before applying, "
            "via adeu's own resolver. Turn off only when targets are already "
            "known-unique."
        ),
    )
    source: Optional[ObjectRef] = Field(
        None, description="Fetch the document from a URL instead of a file part"
    )


class ProcessBatchJsonResponse(BaseModel):
    """JSON form of a batch result, carrying the document inline.

    The binary form returns the DOCX as the body with the summary in a header;
    a per-edit report outgrows what belongs in a header, and the web app
    base64s the document anyway, so JSON is the better shape for a UI.
    """

    document_base64: str
    filename: str
    result: BatchResult


class ReadDocxRequest(BaseModel):
    clean_view: bool = False
    include_appendix: bool = True
    source: Optional[ObjectRef] = None


class DiffRequest(BaseModel):
    compare_clean: bool = True
    original: Optional[ObjectRef] = None
    modified: Optional[ObjectRef] = None

    @model_validator(mode="after")
    def _both_or_neither(self) -> "DiffRequest":
        if bool(self.original) != bool(self.modified):
            raise ValueError(
                "original and modified must both be object references, or both be file parts"
            )
        return self


class AcceptAllRequest(BaseModel):
    remove_comments: bool = Field(
        True,
        description=(
            "Strip comments as well as accepting revisions. Defaults to True to "
            "preserve the pre-2.4 service behaviour, where accept-all always "
            "produced a fully clean document; adeu's own default is False."
        ),
    )
    source: Optional[ObjectRef] = None
