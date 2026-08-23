"""
Adeu DOCX redlining routes — /adeu/*

Wraps the adeu package (2.4.x) behind HTTP endpoints for reading, enumerating
review items, applying tracked-change edits and review actions, accepting or
rejecting everything, CriticMarkup preview, and diffing.

What changed at 2.4 and why it matters here
-------------------------------------------
`RedlineEngine.process_batch()` replaces the separate validate/apply/review
calls and returns a *per-edit* report. Aggregate counts could never tell a
reviewer which edit failed, so callers guessed — or, in the web app's case,
silently substituted plain text and reported success. Every batch now goes
through `process_batch` and the report is returned intact.

`make_edits_self_contained()` resolves ambiguous targets by expanding them with
surrounding context. That logic used to live in a Next.js route in JavaScript,
which forced one full document round trip *per edit* to re-read the text it
needed. Doing it here — where the document is already parsed — collapses a
batch of N edits back into a single call.

Wire formats: the v1 shapes stay frozen (packages/protocol/schemas/v1/
document-editor.*.schema.json, tests/test_contract.py). Everything else is
additive.
"""

import asyncio
import io
import json
import logging
import re
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
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
from adeu.diff import generate_edits_from_text, make_edits_self_contained
from adeu.redline.engine import BatchValidationError

from app.auth import verify_api_key
from app.critic import parse_review_items
from app.config import ServiceConfig
from app.objectref import fetch_document
from app.schemas.adeu import (
    AcceptAllRequest,
    ApplyEditsMarkdownRequest,
    ApplyEditsMarkdownResponse,
    BatchResult,
    BatchSummary,
    DiffRequest,
    DiffResponse,
    EditReport,
    FailedEdit,
    ProcessBatchJsonResponse,
    ProcessBatchRequest,
    ReadDocxRequest,
    ReadDocxResponse,
    ReviewItemsResponse,
)

# stdlib logging (not structlog): structured JSON output and trace IDs come
# from the shared formatter in app.tracing, keeping one logging style
# service-wide.
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/adeu", tags=["adeu"])

DOCX_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)

MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB

# Authentication lives in app/auth.py so every route shares one dependency —
# see the module docstring there for why it is not in this file.


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def sanitize_filename(name: str) -> str:
    """Strip characters that could enable header injection."""
    return re.sub(r'[\r\n";/\\]', "_", name)


def _error(status: int, detail: str, errors: list[str] | None = None) -> JSONResponse:
    body: dict[str, Any] = {"detail": detail}
    if errors:
        body["errors"] = errors
    return JSONResponse(status_code=status, content=body)


async def _read_upload(file: UploadFile, request: Request) -> io.BytesIO:
    """Read an UploadFile into a BytesIO stream, enforcing the size limit.

    Both the declared Content-Length and the actual byte count are checked: a
    request may omit or understate the header, so the header alone is not a
    limit.
    """
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_UPLOAD_SIZE:
                raise HTTPException(status_code=413, detail="File too large")
        except ValueError:
            pass

    data = await file.read()
    if len(data) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="File too large")

    return io.BytesIO(data)


def _parse_body(body: str | None, model: type, default: Any = None) -> Any:
    """Parse a JSON form field into a pydantic model, or return `default`."""
    if body is None or body == "":
        return default
    return model.model_validate_json(body)


def _config(request: Request) -> ServiceConfig:
    """The startup config, or a fail-closed default.

    The lifespan sets `app.state.config` in every real deployment. Reading it
    defensively means a misconfigured or partially-started app returns a clear
    400 ("object references are disabled") instead of a 500 from an attribute
    error — and it keeps the object-reference guard fail-closed rather than
    fail-open if the attribute is ever missing.
    """
    config = getattr(request.app.state, "config", None)
    if isinstance(config, ServiceConfig):
        return config
    return ServiceConfig(
        api_key_configured=False, adeu_available=True, adeu_version=None
    )


async def _resolve_document(
    request: Request,
    file: UploadFile | None,
    source: Any,
    *,
    field: str = "file",
    fallback_name: str = "document.docx",
) -> tuple[io.BytesIO, str]:
    """Produce a document stream from either an upload or an object reference.

    Exactly one is required. An object reference costs the caller nothing —
    the service fetches it directly — which is what removes the four-transfer
    round trip a stored document used to make.
    """
    if file is not None and source is not None:
        raise HTTPException(
            status_code=422,
            detail=f"provide either a {field} upload or a source reference, not both",
        )

    if file is not None:
        return await _read_upload(file, request), (file.filename or fallback_name)

    if source is not None:
        config = _config(request)
        stream = await fetch_document(
            source.url,
            allowed_origins=config.allowed_fetch_origins,
            max_bytes=config.max_fetch_bytes,
            timeout_seconds=config.fetch_timeout_seconds,
            field=field,
        )
        return stream, (source.filename or fallback_name)

    raise HTTPException(
        status_code=422, detail=f"a {field} upload or a source reference is required"
    )


def _to_adeu_edit(edit: Any) -> ModifyText:
    """Map a wire edit onto adeu's ModifyText."""
    kwargs: dict[str, Any] = {
        "target_text": edit.target_text,
        "new_text": edit.new_text,
        "comment": edit.comment,
    }
    match_mode = getattr(edit, "match_mode", None)
    if match_mode:
        kwargs["match_mode"] = match_mode
    return ModifyText(**kwargs)


def _to_adeu_action(action: Any) -> AcceptChange | RejectChange | ReplyComment:
    """Map a wire review action onto adeu's action models."""
    value = action.action.value if hasattr(action.action, "value") else str(action.action)
    if value == "ACCEPT":
        return AcceptChange(target_id=action.target_id, comment=action.comment)
    if value == "REJECT":
        return RejectChange(target_id=action.target_id, comment=action.comment)
    return ReplyComment(target_id=action.target_id, text=action.text or "")


def _build_result(report: dict[str, Any]) -> BatchResult:
    """Translate adeu's batch report into the service's wire shape."""
    edits = [EditReport.model_validate(r) for r in (report.get("edits") or [])]
    failed = [
        FailedEdit.model_validate(f) if isinstance(f, dict) else FailedEdit(reason=str(f))
        for f in (report.get("failed") or [])
    ]
    skipped = report.get("skipped_details") or []
    return BatchResult(
        status=str(report.get("status") or "ok"),
        summary=BatchSummary(
            applied_edits=int(report.get("edits_applied") or 0),
            skipped_edits=int(report.get("edits_skipped") or 0),
            applied_actions=int(report.get("actions_applied") or 0),
            skipped_actions=int(report.get("actions_skipped") or 0),
        ),
        edits=edits,
        failed=failed,
        skipped_details=[str(s) for s in skipped],
        occurrences_modified=int(report.get("occurrences_modified") or 0),
        actions_already_resolved=int(report.get("actions_already_resolved") or 0),
        author_impersonation_warning=report.get("author_impersonation_warning"),
        adeu_version=report.get("version"),
    )


def _validation_errors(exc: BatchValidationError) -> list[str]:
    """Flatten adeu's BatchValidationError into the service's `errors` list.

    `failed` carries (index, reason) pairs when adeu can attribute a failure to
    a specific edit; `errors` is the human-readable fallback.
    """
    failed = getattr(exc, "failed", None)
    if failed:
        out: list[str] = []
        for entry in failed:
            if isinstance(entry, (tuple, list)) and len(entry) == 2:
                out.append(f"Edit {entry[0]}: {entry[1]}")
            else:
                out.append(str(entry))
        return out
    errors = getattr(exc, "errors", None)
    if errors:
        return [str(e) for e in errors]
    return [str(exc)]


def _wants_json(request: Request) -> bool:
    """A caller asking for JSON gets the document inline plus the full report;
    otherwise the DOCX streams as the body with counts in a header."""
    accept = (request.headers.get("accept") or "").lower()
    return "application/json" in accept


# ---------------------------------------------------------------------------
# POST /adeu/read
# ---------------------------------------------------------------------------

@router.post(
    "/read", response_model=ReadDocxResponse, dependencies=[Depends(verify_api_key)]
)
async def read_docx(
    request: Request,
    file: UploadFile | None = File(None),
    clean_view: bool = Form(False),
    body: str | None = Form(None),
):
    """Extract document text as CriticMarkup, or as the accepted ("clean") view.

    `body` accepts a ReadDocxRequest for the object-reference and appendix
    options; the plain `clean_view` form field is kept for existing callers.
    """
    try:
        options: ReadDocxRequest = _parse_body(body, ReadDocxRequest) or ReadDocxRequest(
            clean_view=clean_view
        )
        stream, filename = await _resolve_document(request, file, options.source)

        text = await asyncio.to_thread(
            extract_text_from_stream,
            stream,
            filename,
            options.clean_view or clean_view,
            options.include_appendix,
        )
        return ReadDocxResponse(text=text, filename=filename)
    except HTTPException:
        raise
    except ValueError as exc:
        return _error(422, f"Invalid DOCX file: {exc}")
    except Exception:
        logger.exception("read_docx failed")
        return _error(500, "Internal server error")


# ---------------------------------------------------------------------------
# POST /adeu/review-items
# ---------------------------------------------------------------------------

@router.post(
    "/review-items",
    response_model=ReviewItemsResponse,
    dependencies=[Depends(verify_api_key)],
)
async def review_items(
    request: Request,
    file: UploadFile | None = File(None),
    body: str | None = Form(None),
):
    """List every tracked change and comment in the document, with its id.

    Review actions address changes by ids like `Chg:12`, but nothing previously
    handed a caller that list — the ids exist only inside the extracted
    markup, which made ACCEPT / REJECT / REPLY effectively uncallable from a
    UI. This is that missing half of the review API.
    """
    try:
        options: ReadDocxRequest = _parse_body(body, ReadDocxRequest) or ReadDocxRequest()
        stream, filename = await _resolve_document(request, file, options.source)

        def _run() -> tuple[str, set[str]]:
            stream.seek(0)
            markup = extract_text_from_stream(stream, filename, False, True)
            stream.seek(0)
            try:
                authors = RedlineEngine(stream).get_pending_revision_authors()
            except Exception:
                # Author collection is a display nicety; never fail the listing
                # because one part of the document could not be walked.
                logger.warning("could not collect pending revision authors", exc_info=True)
                authors = set()
            return markup, authors

        markup, authors = await asyncio.to_thread(_run)
        items = parse_review_items(markup)

        return ReviewItemsResponse(
            filename=filename,
            items=items,
            authors=sorted(authors),
            change_count=sum(1 for i in items if i.kind != "comment"),
            comment_count=sum(1 for i in items if i.kind == "comment"),
        )
    except HTTPException:
        raise
    except ValueError as exc:
        return _error(422, f"Invalid DOCX file: {exc}")
    except Exception:
        logger.exception("review_items failed")
        return _error(500, "Internal server error")


# ---------------------------------------------------------------------------
# POST /adeu/process-batch
# ---------------------------------------------------------------------------

@router.post("/process-batch", dependencies=[Depends(verify_api_key)])
async def process_batch(
    request: Request,
    file: UploadFile | None = File(None),
    body: str = Form(...),
):
    """Apply a batch of edits and/or review actions in one pass.

    Returns the modified DOCX as the body with an `X-Batch-Summary` header, or
    — when the caller sends `Accept: application/json` — the document base64'd
    alongside the full per-edit report, which is too large for a header.
    """
    try:
        req = ProcessBatchRequest.model_validate_json(body)
    except Exception as exc:
        return _error(422, f"Invalid request body: {exc}")

    has_edits = bool(req.edits)
    has_actions = bool(req.actions)
    if not has_edits and not has_actions:
        return _error(422, "At least one edit or action is required")

    try:
        stream, filename = await _resolve_document(request, file, req.source)

        def _run_batch() -> tuple[io.BytesIO, dict[str, Any]]:
            engine = RedlineEngine(stream, req.author_name)

            changes: list[Any] = []
            # Review actions first: accepting or rejecting an existing revision
            # changes the text that a subsequent edit has to match against.
            if has_actions:
                changes.extend(_to_adeu_action(a) for a in (req.actions or []))

            if has_edits:
                edits = [_to_adeu_edit(e) for e in (req.edits or [])]
                if req.self_contained and edits:
                    # Expand ambiguous targets with surrounding context, using
                    # adeu's resolver against the document's own text.
                    stream.seek(0)
                    original_text = extract_text_from_stream(stream, filename, False, True)
                    try:
                        edits = make_edits_self_contained(edits, original_text)
                    except Exception:
                        # A resolver failure must not lose the batch; fall back
                        # to the caller's literal targets and let validation
                        # report any ambiguity.
                        logger.warning(
                            "make_edits_self_contained failed; using literal targets",
                            exc_info=True,
                        )
                changes.extend(edits)

            report = engine.process_batch(changes, partial=req.partial)
            return engine.save_to_stream(), report

        try:
            result_stream, report = await asyncio.to_thread(_run_batch)
        except BatchValidationError as exc:
            # An all-or-nothing batch that cannot apply everything is a 422
            # naming each reason, matching the pre-2.4 contract. `partial`
            # opts out and gets a per-edit report instead.
            return _error(422, "Batch rejected", errors=_validation_errors(exc))

        result = _build_result(report)

        # `partial` batches report failures in the body rather than raising, but
        # a batch that applied nothing at all is still a rejection.
        if not req.partial and result.status == "failed":
            reasons = [f.reason for f in result.failed if f.reason] or result.skipped_details
            return _error(422, "Batch rejected", errors=reasons or ["batch could not be applied"])

        safe_filename = sanitize_filename(filename or "modified.docx")

        if _wants_json(request):
            import base64

            return ProcessBatchJsonResponse(
                document_base64=base64.b64encode(result_stream.getvalue()).decode("ascii"),
                filename=safe_filename,
                result=result,
            )

        return StreamingResponse(
            result_stream,
            media_type=DOCX_CONTENT_TYPE,
            headers={
                "Content-Disposition": f'attachment; filename="{safe_filename}"',
                "X-Batch-Summary": result.summary.model_dump_json(),
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
# POST /adeu/accept-all  ·  POST /adeu/reject-all
# ---------------------------------------------------------------------------

async def _resolve_all(
    request: Request,
    file: UploadFile | None,
    body: str | None,
    *,
    accept: bool,
):
    options: AcceptAllRequest = _parse_body(body, AcceptAllRequest) or AcceptAllRequest()
    stream, filename = await _resolve_document(request, file, options.source)

    def _run() -> io.BytesIO:
        engine = RedlineEngine(stream)
        if accept:
            # adeu 2.4 defaults remove_comments to False; this service has
            # always produced a fully clean document, so the default is kept
            # at True here and callers opt out explicitly.
            engine.accept_all_revisions(remove_comments=options.remove_comments)
        else:
            engine.reject_all_revisions()
        return engine.save_to_stream()

    result_stream = await asyncio.to_thread(_run)
    default_name = "accepted.docx" if accept else "rejected.docx"
    safe_filename = sanitize_filename(filename or default_name)

    return StreamingResponse(
        result_stream,
        media_type=DOCX_CONTENT_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'},
    )


@router.post("/accept-all", dependencies=[Depends(verify_api_key)])
async def accept_all(
    request: Request,
    file: UploadFile | None = File(None),
    body: str | None = Form(None),
):
    """Accept all tracked changes, returning a clean DOCX."""
    try:
        return await _resolve_all(request, file, body, accept=True)
    except HTTPException:
        raise
    except ValueError as exc:
        return _error(422, f"Invalid DOCX file: {exc}")
    except Exception:
        logger.exception("accept_all failed")
        return _error(500, "Internal server error")


@router.post("/reject-all", dependencies=[Depends(verify_api_key)])
async def reject_all(
    request: Request,
    file: UploadFile | None = File(None),
    body: str | None = Form(None),
):
    """Reject all tracked changes, restoring the document's original text."""
    try:
        return await _resolve_all(request, file, body, accept=False)
    except HTTPException:
        raise
    except ValueError as exc:
        return _error(422, f"Invalid DOCX file: {exc}")
    except Exception:
        logger.exception("reject_all failed")
        return _error(500, "Internal server error")


# ---------------------------------------------------------------------------
# POST /adeu/apply-edits-markdown
# ---------------------------------------------------------------------------

@router.post(
    "/apply-edits-markdown",
    response_model=ApplyEditsMarkdownResponse,
    dependencies=[Depends(verify_api_key)],
)
async def apply_edits_markdown(
    request: Request,
    file: UploadFile | None = File(None),
    body: str = Form(...),
):
    """Preview proposed edits as CriticMarkup-annotated Markdown."""
    try:
        req = ApplyEditsMarkdownRequest.model_validate_json(body)
    except Exception as exc:
        return _error(422, f"Invalid request body: {exc}")

    try:
        source = getattr(req, "source", None)
        stream, filename = await _resolve_document(request, file, source)

        def _run() -> str:
            text = extract_text_from_stream(stream, filename, False, True)
            edits = [_to_adeu_edit(e) for e in req.edits]
            return apply_edits_to_markdown(
                text,
                edits,
                include_index=req.include_index,
                highlight_only=req.highlight_only,
            )

        markdown = await asyncio.to_thread(_run)
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

@router.post(
    "/diff", response_model=DiffResponse, dependencies=[Depends(verify_api_key)]
)
async def diff_docx(
    request: Request,
    original: UploadFile | None = File(None),
    modified: UploadFile | None = File(None),
    compare_clean: bool = Form(True),
    body: str | None = Form(None),
):
    """Compare two DOCX files and return a text-based diff."""
    try:
        options: DiffRequest = _parse_body(body, DiffRequest) or DiffRequest(
            compare_clean=compare_clean
        )
        original_stream, original_name = await _resolve_document(
            request, original, options.original, field="original", fallback_name="original.docx"
        )
        modified_stream, modified_name = await _resolve_document(
            request, modified, options.modified, field="modified", fallback_name="modified.docx"
        )
        clean = options.compare_clean if body else compare_clean

        def _run() -> tuple[str, bool]:
            orig_text = extract_text_from_stream(original_stream, original_name, clean, True)
            mod_text = extract_text_from_stream(modified_stream, modified_name, clean, True)
            edits = generate_edits_from_text(orig_text, mod_text)
            diff_text = (
                "\n".join(f"- {e.target_text}\n+ {e.new_text}" for e in edits) if edits else ""
            )
            return diff_text, len(edits) > 0

        diff_text, has_differences = await asyncio.to_thread(_run)
        return DiffResponse(diff=diff_text, has_differences=has_differences)
    except HTTPException:
        raise
    except ValueError as exc:
        return _error(422, f"Invalid DOCX file: {exc}")
    except Exception:
        logger.exception("diff_docx failed")
        return _error(500, "Internal server error")
