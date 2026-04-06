import base64
import cgi
import io
import json
import logging
import os
import sys
from typing import Any, Optional
from urllib.parse import urlparse


logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Shared imports (from sidecar schemas)
# ---------------------------------------------------------------------------
#
# Vercel runs this file in isolation; ensure the sidecar folder is on sys.path
# so `app.schemas.adeu` and/or `sidecar.app.schemas.adeu` can be imported.
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SIDE_CAR_DIR = os.path.join(ROOT_DIR, "sidecar")
if SIDE_CAR_DIR not in sys.path:
    sys.path.insert(0, SIDE_CAR_DIR)
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

try:
    # Preferred by requirements: explicit sidecar namespace.
    from sidecar.app.schemas.adeu import (  # type: ignore
        ApplyEditsMarkdownRequest,
        ApplyEditsMarkdownResponse,
        BatchSummary,
        DiffResponse,
        ProcessBatchRequest,
        ReadDocxResponse,
        ErrorResponse,
    )
except Exception:
    # Sidecar uses an `app.*` import style; mirror sidecar runtime imports.
    from app.schemas.adeu import (  # type: ignore
        ApplyEditsMarkdownRequest,
        ApplyEditsMarkdownResponse,
        BatchSummary,
        DiffResponse,
        ProcessBatchRequest,
        ReadDocxResponse,
        ErrorResponse,
    )


# ---------------------------------------------------------------------------
# Adeu imports (v0.9.0)
# ---------------------------------------------------------------------------
from adeu import (  # noqa: E402
    AcceptChange,
    ModifyText,
    RedlineEngine,
    RejectChange,
    ReplyComment,
    apply_edits_to_markdown,
    extract_text_from_stream,
)
from adeu.diff import generate_edits_from_text  # noqa: E402


DOCX_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)


def _json_response(status: int, body: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def _error(status: int, detail: str, errors: Optional[list[str]] = None) -> dict[str, Any]:
    body: dict[str, Any] = {"detail": detail}
    if errors:
        body["errors"] = errors
    return _json_response(status, body)


def _parse_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    s = str(value).strip().lower()
    if s in {"1", "true", "t", "yes", "y", "on"}:
        return True
    if s in {"0", "false", "f", "no", "n", "off"}:
        return False
    return default


def _get_headers(request: dict[str, Any]) -> dict[str, str]:
    headers = request.get("headers") or {}
    # Vercel normalizes headers, but handle case differences.
    out: dict[str, str] = {}
    if isinstance(headers, dict):
        for k, v in headers.items():
            if k is None:
                continue
            out[str(k).lower()] = str(v)
    return out


def _get_path(request: dict[str, Any]) -> str:
    # Vercel request shape varies; prefer `path`, fallback to `url`.
    path = request.get("path")
    if isinstance(path, str) and path:
        return path
    url = request.get("url")
    if isinstance(url, str) and url:
        parsed = urlparse(url)
        return parsed.path or url
    return ""


def _get_raw_body(request: dict[str, Any]) -> bytes:
    body = request.get("body", b"")
    is_b64 = bool(request.get("isBase64Encoded"))
    if body is None:
        return b""
    if isinstance(body, bytes):
        if is_b64:
            return base64.b64decode(body)
        return body
    if isinstance(body, str):
        if is_b64:
            return base64.b64decode(body)
        return body.encode("utf-8")
    # Unknown type; best-effort serialization.
    b = str(body).encode("utf-8")
    if is_b64:
        return base64.b64decode(b)
    return b


def _parse_multipart(request: dict[str, Any]) -> cgi.FieldStorage:
    headers = _get_headers(request)
    content_type = headers.get("content-type") or headers.get("Content-Type".lower())
    if not content_type:
        raise ValueError("Missing Content-Type header")

    raw_body = _get_raw_body(request)
    environ = {
        "REQUEST_METHOD": request.get("method", "POST"),
        "CONTENT_TYPE": content_type,
        "CONTENT_LENGTH": str(len(raw_body)),
    }
    fp = io.BytesIO(raw_body)
    return cgi.FieldStorage(fp=fp, environ=environ, keep_blank_values=True)


def _field_str(form: cgi.FieldStorage, name: str) -> Optional[str]:
    try:
        item = form[name]
    except Exception:
        return None
    if item is None:
        return None
    # Non-file fields expose `.value` as string (or bytes in some cases).
    v = getattr(item, "value", None)
    if v is None:
        return None
    if isinstance(v, bytes):
        return v.decode("utf-8", errors="replace")
    return str(v)


def _field_file(form: cgi.FieldStorage, name: str) -> tuple[io.BytesIO, str]:
    item = form[name]
    if item is None or getattr(item, "file", None) is None:
        raise ValueError(f"Missing file field: {name}")
    filename = getattr(item, "filename", None) or f"{name}.docx"
    raw = item.file.read()
    return io.BytesIO(raw), filename


def _docx_response(
    status: int,
    result_stream: Any,
    *,
    content_disposition: str,
    extra_headers: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    if hasattr(result_stream, "getvalue"):
        result_bytes = result_stream.getvalue()
    elif isinstance(result_stream, (bytes, bytearray)):
        result_bytes = bytes(result_stream)
    else:
        # Best effort: read file-like objects.
        result_bytes = result_stream.read()

    body_b64 = base64.b64encode(result_bytes).decode("ascii")
    headers = {"Content-Type": DOCX_CONTENT_TYPE, "Content-Disposition": content_disposition}
    if extra_headers:
        headers.update(extra_headers)

    return {
        "statusCode": status,
        "headers": headers,
        "body": body_b64,
        "isBase64Encoded": True,
    }


def _read_docx(request: dict[str, Any]) -> dict[str, Any]:
    try:
        form = _parse_multipart(request)
        clean_view = _parse_bool(_field_str(form, "clean_view"), default=False)
        stream, filename = _field_file(form, "file")
        text = extract_text_from_stream(stream, filename or "document.docx", clean_view)
        res = ReadDocxResponse(text=text, filename=filename or "document.docx")
        return _json_response(200, res.model_dump())
    except ValueError as exc:
        return _error(422, f"Invalid DOCX file: {exc}")
    except Exception as exc:
        logger.exception("read_docx failed")
        return _error(500, f"Internal error: {exc}")


def _process_batch(request: dict[str, Any]) -> dict[str, Any]:
    try:
        form = _parse_multipart(request)
        body_str = _field_str(form, "body")
        if body_str is None:
            raise ValueError("Missing form field: body")

        try:
            req = ProcessBatchRequest.model_validate_json(body_str)
        except Exception as exc:
            return _error(422, f"Invalid request body: {exc}")

        has_edits = bool(req.edits) and len(req.edits or []) > 0
        has_actions = bool(req.actions) and len(req.actions or []) > 0
        if not has_edits and not has_actions:
            return _error(422, "At least one edit or action is required")

        stream, filename = _field_file(form, "file")
        engine = RedlineEngine(stream, req.author_name)

        applied_actions = 0
        skipped_actions = 0
        applied_edits = 0
        skipped_edits = 0

        # Apply review actions first (accept/reject/reply on existing changes)
        if has_actions:
            adeu_actions = []
            for a in req.actions or []:
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
                for e in (req.edits or [])
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

        return _docx_response(
            200,
            result_stream,
            content_disposition=f'attachment; filename="{filename or "modified.docx"}"',
            extra_headers={"X-Batch-Summary": summary.model_dump_json()},
        )
    except ValueError as exc:
        return _error(422, f"Invalid DOCX file: {exc}")
    except Exception as exc:
        logger.exception("process_batch failed")
        return _error(500, f"Internal error: {exc}")


def _accept_all(request: dict[str, Any]) -> dict[str, Any]:
    try:
        form = _parse_multipart(request)
        stream, filename = _field_file(form, "file")
        engine = RedlineEngine(stream)
        engine.accept_all_revisions()
        result_stream = engine.save_to_stream()
        return _docx_response(
            200,
            result_stream,
            content_disposition=f'attachment; filename="{filename or "accepted.docx"}"',
        )
    except ValueError as exc:
        return _error(422, f"Invalid DOCX file: {exc}")
    except Exception as exc:
        logger.exception("accept_all failed")
        return _error(500, f"Internal error: {exc}")


def _apply_edits_markdown(request: dict[str, Any]) -> dict[str, Any]:
    try:
        form = _parse_multipart(request)
        body_str = _field_str(form, "body")
        if body_str is None:
            raise ValueError("Missing form field: body")

        try:
            req = ApplyEditsMarkdownRequest.model_validate_json(body_str)
        except Exception as exc:
            return _error(422, f"Invalid request body: {exc}")

        stream, filename = _field_file(form, "file")
        text = extract_text_from_stream(stream, filename or "document.docx")
        adeu_edits = [
            ModifyText(target_text=e.target_text, new_text=e.new_text, comment=e.comment)
            for e in req.edits
        ]
        markdown = apply_edits_to_markdown(
            text,
            adeu_edits,
            include_index=req.include_index,
            highlight_only=req.highlight_only,
        )
        res = ApplyEditsMarkdownResponse(markdown=markdown)
        return _json_response(200, res.model_dump())
    except ValueError as exc:
        return _error(422, f"Invalid DOCX file: {exc}")
    except Exception as exc:
        logger.exception("apply_edits_markdown failed")
        return _error(500, f"Internal error: {exc}")


def _diff_docx(request: dict[str, Any]) -> dict[str, Any]:
    try:
        form = _parse_multipart(request)
        compare_clean = _parse_bool(_field_str(form, "compare_clean"), default=True)

        original_stream, original_filename = _field_file(form, "original")
        modified_stream, modified_filename = _field_file(form, "modified")

        original_text = extract_text_from_stream(
            original_stream,
            original_filename or "original.docx",
            clean_view=compare_clean,
        )
        modified_text = extract_text_from_stream(
            modified_stream,
            modified_filename or "modified.docx",
            clean_view=compare_clean,
        )

        edits = generate_edits_from_text(original_text, modified_text)
        diff_text = (
            "\n".join(f"- {e.target_text}\n+ {e.new_text}" for e in edits) if edits else ""
        )
        res = DiffResponse(diff=diff_text, has_differences=len(edits) > 0)
        return _json_response(200, res.model_dump())
    except ValueError as exc:
        return _error(422, f"Invalid DOCX file: {exc}")
    except Exception as exc:
        logger.exception("diff_docx failed")
        return _error(500, f"Internal error: {exc}")


def handler(request: dict[str, Any], context: Any = None) -> dict[str, Any]:
    """
    Vercel serverless entrypoint for all ADEU endpoints.

    Expected routes:
      - /api/adeu/read
      - /api/adeu/process-batch
      - /api/adeu/accept-all
      - /api/adeu/apply-edits-markdown
      - /api/adeu/diff
    """
    path = _get_path(request)
    # Normalize: keep only the portion after `/api/adeu`.
    base = "/api/adeu"
    if path.startswith(base):
        suffix = path[len(base) :]
    else:
        # Fallback for cases where path may include the full URL.
        suffix = path
        if "/api/adeu" in suffix:
            suffix = suffix.split("/api/adeu", 1)[1]

    suffix = suffix.strip("/")
    if suffix == "read":
        return _read_docx(request)
    if suffix == "process-batch":
        return _process_batch(request)
    if suffix == "accept-all":
        return _accept_all(request)
    if suffix == "apply-edits-markdown":
        return _apply_edits_markdown(request)
    if suffix == "diff":
        return _diff_docx(request)

    return _error(404, f"Not found: /api/adeu/{suffix or ''}".rstrip())

