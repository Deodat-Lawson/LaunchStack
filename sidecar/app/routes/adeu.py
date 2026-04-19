"""
Adeu DOCX redlining routes — /adeu/*
Wraps the adeu pip package behind FastAPI endpoints for reading,
editing, accepting changes, markdown preview, and diffing DOCX files.
"""

import asyncio
import io
import os
import re

import structlog
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Security, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.security import APIKeyHeader

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

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/adeu", tags=["adeu"])

DOCX_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)

MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB

# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def verify_api_key(api_key: str = Security(_api_key_header)) -> None:
    """Validate X-API-Key against SIDECAR_API_KEY env var."""
    expected = os.environ.get("SIDECAR_API_KEY", "")
    if not expected or api_key != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def sanitize_filename(name: str) -> str:
    """Strip characters that could enable header injection."""
    return re.sub(r'[\r\n";/\\]', '_', name)


async def _read_upload(file: UploadFile, request: Request) -> io.BytesIO:
    """Read an UploadFile into a BytesIO stream, enforcing size limit."""
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="File too large")

    data = await file.read()
    if len(data) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="File too large")

    return io.BytesIO(data)


def _error(status: int, detail: str, errors: list[str] | None = None) -> JSONResponse:
    body: dict = {"detail": detail}
    if errors:
        body["errors"] = errors
    return JSONResponse(status_code=status, content=body)


# ---------------------------------------------------------------------------
# POST /adeu/read
# ---------------------------------------------------------------------------

@router.post("/read", response_model=ReadDocxResponse, dependencies=[Depends(verify_api_key)])
async def read_docx(
    request: Request,
    file: UploadFile = File(...),
    clean_view: bool = Form(False),
):
    """Extract text from a DOCX file, optionally as clean (accepted-state) view."""
    try:
        stream = await _read_upload(file, request)
        text = await asyncio.to_thread(
            extract_text_from_stream, stream, file.filename or "document.docx", clean_view
        )
        return ReadDocxResponse(text=text, filename=file.filename or "document.docx")
    except HTTPException:
        raise
    except ValueError as exc:
        return _error(422, f"Invalid DOCX file: {exc}")
    except Exception:
        logger.exception("read_docx failed")
        return _error(500, "Internal server error")


# ---------------------------------------------------------------------------
# POST /adeu/process-batch
# ---------------------------------------------------------------------------

@router.post("/process-batch", dependencies=[Depends(verify_api_key)])
async def process_batch(
    request: Request,
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
        stream = await _read_upload(file, request)

        def _run_batch() -> tuple:
            engine = RedlineEngine(stream, req.author_name)

            applied_actions = 0
            skipped_actions = 0
            applied_edits = 0
            skipped_edits = 0

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

            if has_edits:
                adeu_edits = [
                    ModifyText(target_text=e.target_text, new_text=e.new_text, comment=e.comment)
                    for e in req.edits
                ]
                validation_errors = engine.validate_edits(adeu_edits)
                if validation_errors:
                    return None, validation_errors, None, None, None, None
                applied_edits, skipped_edits = engine.apply_edits(adeu_edits)

            result_stream = engine.save_to_stream()
            return result_stream, None, applied_edits, skipped_edits, applied_actions, skipped_actions

        result_stream, validation_errors, applied_edits, skipped_edits, applied_actions, skipped_actions = (
            await asyncio.to_thread(_run_batch)
        )

        if validation_errors:
            return _error(422, "Batch rejected", errors=validation_errors)

        summary = BatchSummary(
            applied_edits=applied_edits,
            skipped_edits=skipped_edits,
            applied_actions=applied_actions,
            skipped_actions=skipped_actions,
        )
        safe_filename = sanitize_filename(file.filename or "modified.docx")

        return StreamingResponse(
            result_stream,
            media_type=DOCX_CONTENT_TYPE,
            headers={
                "Content-Disposition": f'attachment; filename="{safe_filename}"',
                "X-Batch-Summary": summary.model_dump_json(),
            },
        )
    except HTTPException:
        raise
    except ValueError as exc:
        return _error(422, f"Invalid DOCX file: {exc}")
    except Exception:
        logger.exception("process_batch failed")
        return _error(500, "Internal server error")


# ---------------------------------------------------------------------------
# POST /adeu/accept-all
# ---------------------------------------------------------------------------

@router.post("/accept-all", dependencies=[Depends(verify_api_key)])
async def accept_all(request: Request, file: UploadFile = File(...)):
    """Accept all tracked changes and remove comments, returning a clean DOCX."""
    try:
        stream = await _read_upload(file, request)

        def _run_accept_all() -> io.BytesIO:
            engine = RedlineEngine(stream)
            engine.accept_all_revisions()
            return engine.save_to_stream()

        result_stream = await asyncio.to_thread(_run_accept_all)
        safe_filename = sanitize_filename(file.filename or "accepted.docx")

        return StreamingResponse(
            result_stream,
            media_type=DOCX_CONTENT_TYPE,
            headers={
                "Content-Disposition": f'attachment; filename="{safe_filename}"',
            },
        )
    except HTTPException:
        raise
    except ValueError as exc:
        return _error(422, f"Invalid DOCX file: {exc}")
    except Exception:
        logger.exception("accept_all failed")
        return _error(500, "Internal server error")


# ---------------------------------------------------------------------------
# POST /adeu/apply-edits-markdown
# ---------------------------------------------------------------------------

@router.post("/apply-edits-markdown", response_model=ApplyEditsMarkdownResponse, dependencies=[Depends(verify_api_key)])
async def apply_edits_markdown(
    request: Request,
    file: UploadFile = File(...),
    body: str = Form(...),
):
    """Preview proposed edits as CriticMarkup-annotated Markdown."""
    try:
        req = ApplyEditsMarkdownRequest.model_validate_json(body)
    except Exception as exc:
        return _error(422, f"Invalid request body: {exc}")

    try:
        stream = await _read_upload(file, request)

        def _run_apply_markdown() -> str:
            text = extract_text_from_stream(stream, file.filename or "document.docx")
            adeu_edits = [
                ModifyText(target_text=e.target_text, new_text=e.new_text, comment=e.comment)
                for e in req.edits
            ]
            return apply_edits_to_markdown(
                text, adeu_edits, include_index=req.include_index, highlight_only=req.highlight_only
            )

        markdown = await asyncio.to_thread(_run_apply_markdown)
        return ApplyEditsMarkdownResponse(markdown=markdown)
    except HTTPException:
        raise
    except ValueError as exc:
        return _error(422, f"Invalid DOCX file: {exc}")
    except Exception:
        logger.exception("apply_edits_markdown failed")
        return _error(500, "Internal server error")


# ---------------------------------------------------------------------------
# POST /adeu/diff
# ---------------------------------------------------------------------------

@router.post("/diff", response_model=DiffResponse, dependencies=[Depends(verify_api_key)])
async def diff_docx(
    request: Request,
    original: UploadFile = File(...),
    modified: UploadFile = File(...),
    compare_clean: bool = Form(True),
):
    """Compare two DOCX files and return a text-based diff."""
    try:
        original_stream = await _read_upload(original, request)
        modified_stream = await _read_upload(modified, request)

        def _run_diff() -> tuple:
            orig_text = extract_text_from_stream(
                original_stream, original.filename or "original.docx", clean_view=compare_clean
            )
            mod_text = extract_text_from_stream(
                modified_stream, modified.filename or "modified.docx", clean_view=compare_clean
            )
            edits = generate_edits_from_text(orig_text, mod_text)
            diff_text = "\n".join(
                f"- {e.target_text}\n+ {e.new_text}" for e in edits
            ) if edits else ""
            return diff_text, len(edits) > 0

        diff_text, has_differences = await asyncio.to_thread(_run_diff)
        return DiffResponse(diff=diff_text, has_differences=has_differences)
    except HTTPException:
        raise
    except ValueError as exc:
        return _error(422, f"Invalid DOCX file: {exc}")
    except Exception:
        logger.exception("diff_docx failed")
        return _error(500, "Internal server error")
