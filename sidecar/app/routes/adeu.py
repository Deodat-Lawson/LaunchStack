"""
Adeu DOCX redlining routes — /adeu/*
Wraps the adeu pip package behind FastAPI endpoints for reading,
editing, accepting changes, markdown preview, and diffing DOCX files.
"""

import io
import logging

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

from adeu import (
    AcceptChange,
    ModifyText,
    RedlineEngine,
    RejectChange,
    ReplyComment,
    apply_edits_to_markdown,
    extract_text_from_stream,
)
from adeu.diff import generate_edits_from_text

from app.schemas.adeu import (
    ApplyEditsMarkdownRequest,
    ApplyEditsMarkdownResponse,
    BatchSummary,
    DiffResponse,
    ProcessBatchRequest,
    ReadDocxResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/adeu", tags=["adeu"])

DOCX_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _read_upload(file: UploadFile) -> io.BytesIO:
    """Read an UploadFile into a BytesIO stream for adeu consumption."""
    return io.BytesIO(await file.read())


def _error(status: int, detail: str, errors: list[str] | None = None) -> JSONResponse:
    body: dict = {"detail": detail}
    if errors:
        body["errors"] = errors
    return JSONResponse(status_code=status, content=body)


# ---------------------------------------------------------------------------
# POST /adeu/read
# ---------------------------------------------------------------------------

@router.post("/read", response_model=ReadDocxResponse)
async def read_docx(
    file: UploadFile = File(...),
    clean_view: bool = Form(False),
):
    """Extract text from a DOCX file, optionally as clean (accepted-state) view."""
    try:
        stream = await _read_upload(file)
        text = extract_text_from_stream(stream, file.filename or "document.docx", clean_view)
        return ReadDocxResponse(text=text, filename=file.filename or "document.docx")
    except ValueError as exc:
        return _error(422, f"Invalid DOCX file: {exc}")
    except Exception as exc:
        logger.exception("read_docx failed")
        return _error(500, f"Internal error: {exc}")


# ---------------------------------------------------------------------------
# POST /adeu/process-batch
# ---------------------------------------------------------------------------

@router.post("/process-batch")
async def process_batch(
    file: UploadFile = File(...),
    body: str = Form(...),
):
    """Apply a batch of edits and/or review actions to a DOCX file."""
    try:
        req = ProcessBatchRequest.model_validate_json(body)
    except Exception as exc:
        return _error(422, f"Invalid request body: {exc}")

    has_edits = req.edits and len(req.edits) > 0
    has_actions = req.actions and len(req.actions) > 0
    if not has_edits and not has_actions:
        return _error(422, "At least one edit or action is required")

    try:
        stream = await _read_upload(file)
        engine = RedlineEngine(stream, req.author_name)

        applied_actions = 0
        skipped_actions = 0
        applied_edits = 0
        skipped_edits = 0

        # Apply review actions first (accept/reject/reply on existing changes)
        if has_actions:
            adeu_actions = []
            for a in req.actions:
                if a.action.value == "ACCEPT":
                    adeu_actions.append(AcceptChange(target_id=a.target_id, comment=a.comment))
                elif a.action.value == "REJECT":
                    adeu_actions.append(RejectChange(target_id=a.target_id, comment=a.comment))
                elif a.action.value == "REPLY":
                    adeu_actions.append(ReplyComment(target_id=a.target_id, text=a.text or ""))
            applied_actions, skipped_actions = engine.apply_review_actions(adeu_actions)

        # Then apply text edits as tracked changes
        if has_edits:
            adeu_edits = [
                ModifyText(target_text=e.target_text, new_text=e.new_text, comment=e.comment)
                for e in req.edits
            ]

            # Validate edits first — reject entire batch on validation failure
            validation_errors = engine.validate_edits(adeu_edits)
            if validation_errors:
                return _error(422, "Batch rejected", errors=validation_errors)

            applied_edits, skipped_edits = engine.apply_edits(adeu_edits)

        result_stream = engine.save_to_stream()
        summary = BatchSummary(
            applied_edits=applied_edits,
            skipped_edits=skipped_edits,
            applied_actions=applied_actions,
            skipped_actions=skipped_actions,
        )

        return StreamingResponse(
            result_stream,
            media_type=DOCX_CONTENT_TYPE,
            headers={
                "Content-Disposition": f'attachment; filename="{file.filename or "modified.docx"}"',
                "X-Batch-Summary": summary.model_dump_json(),
            },
        )
    except ValueError as exc:
        return _error(422, f"Invalid DOCX file: {exc}")
    except Exception as exc:
        logger.exception("process_batch failed")
        return _error(500, f"Internal error: {exc}")


# ---------------------------------------------------------------------------
# POST /adeu/accept-all
# ---------------------------------------------------------------------------

@router.post("/accept-all")
async def accept_all(file: UploadFile = File(...)):
    """Accept all tracked changes and remove comments, returning a clean DOCX."""
    try:
        stream = await _read_upload(file)
        engine = RedlineEngine(stream)
        engine.accept_all_revisions()
        result_stream = engine.save_to_stream()

        return StreamingResponse(
            result_stream,
            media_type=DOCX_CONTENT_TYPE,
            headers={
                "Content-Disposition": f'attachment; filename="{file.filename or "accepted.docx"}"',
            },
        )
    except ValueError as exc:
        return _error(422, f"Invalid DOCX file: {exc}")
    except Exception as exc:
        logger.exception("accept_all failed")
        return _error(500, f"Internal error: {exc}")


# ---------------------------------------------------------------------------
# POST /adeu/apply-edits-markdown
# ---------------------------------------------------------------------------

@router.post("/apply-edits-markdown", response_model=ApplyEditsMarkdownResponse)
async def apply_edits_markdown(
    file: UploadFile = File(...),
    body: str = Form(...),
):
    """Preview proposed edits as CriticMarkup-annotated Markdown."""
    try:
        req = ApplyEditsMarkdownRequest.model_validate_json(body)
    except Exception as exc:
        return _error(422, f"Invalid request body: {exc}")

    try:
        stream = await _read_upload(file)
        text = extract_text_from_stream(stream, file.filename or "document.docx")
        adeu_edits = [
            ModifyText(target_text=e.target_text, new_text=e.new_text, comment=e.comment)
            for e in req.edits
        ]
        markdown = apply_edits_to_markdown(
            text, adeu_edits, include_index=req.include_index, highlight_only=req.highlight_only
        )
        return ApplyEditsMarkdownResponse(markdown=markdown)
    except ValueError as exc:
        return _error(422, f"Invalid DOCX file: {exc}")
    except Exception as exc:
        logger.exception("apply_edits_markdown failed")
        return _error(500, f"Internal error: {exc}")


# ---------------------------------------------------------------------------
# POST /adeu/diff
# ---------------------------------------------------------------------------

@router.post("/diff", response_model=DiffResponse)
async def diff_docx(
    original: UploadFile = File(...),
    modified: UploadFile = File(...),
    compare_clean: bool = Form(True),
):
    """Compare two DOCX files and return a text-based diff."""
    try:
        original_stream = await _read_upload(original)
        modified_stream = await _read_upload(modified)

        original_text = extract_text_from_stream(
            original_stream, original.filename or "original.docx", clean_view=compare_clean
        )
        modified_text = extract_text_from_stream(
            modified_stream, modified.filename or "modified.docx", clean_view=compare_clean
        )

        edits = generate_edits_from_text(original_text, modified_text)
        diff_text = "\n".join(
            f"- {e.target_text}\n+ {e.new_text}" for e in edits
        ) if edits else ""

        return DiffResponse(diff=diff_text, has_differences=len(edits) > 0)
    except ValueError as exc:
        return _error(422, f"Invalid DOCX file: {exc}")
    except Exception as exc:
        logger.exception("diff_docx failed")
        return _error(500, f"Internal error: {exc}")
