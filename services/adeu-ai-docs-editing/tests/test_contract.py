"""
Contract tests: the adeu-ai-docs-editing service's pydantic wire models must
satisfy the frozen JSON Schemas in packages/protocol/schemas/v1. A field
added, removed, or retyped on either side fails here instead of drifting
silently.
"""

import json
from pathlib import Path

import jsonschema
import pytest

from app.schemas.adeu import (
    ApplyEditsMarkdownRequest,
    ApplyEditsMarkdownResponse,
    BatchSummary,
    DiffResponse,
    DocumentEditSchema,
    ErrorResponse,
    ProcessBatchRequest,
    ReadDocxResponse,
    ReviewActionSchema,
    ReviewActionType,
)


def _schema_dir() -> Path:
    """Locate packages/protocol/schemas/v1 by walking up from this file, so
    the tests work regardless of the pytest invocation directory."""
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "packages" / "protocol" / "schemas" / "v1"
        if candidate.is_dir():
            return candidate
    raise RuntimeError(
        "Could not locate packages/protocol/schemas/v1 above " + __file__
    )


def _load_schema(name: str) -> dict:
    return json.loads((_schema_dir() / name).read_text())


def _wire(model) -> dict:
    """Serialize the way FastAPI does: through JSON."""
    return json.loads(model.model_dump_json())


# ── document-editor.document-edit ───────────────────────────────────────────

class TestDocumentEditContract:
    SCHEMA = "document-editor.document-edit.schema.json"

    def test_edit_with_comment_validates(self):
        model = DocumentEditSchema(
            target_text="old", new_text="new", comment="why"
        )
        jsonschema.validate(_wire(model), _load_schema(self.SCHEMA))

    def test_edit_without_comment_validates(self):
        model = DocumentEditSchema(target_text="old", new_text="new")
        payload = _wire(model)
        assert payload["comment"] is None  # serialized as null, allowed
        jsonschema.validate(payload, _load_schema(self.SCHEMA))


# ── document-editor.process-batch-request ───────────────────────────────────

class TestProcessBatchRequestContract:
    SCHEMA = "document-editor.process-batch-request.schema.json"

    def test_edits_only_validates(self):
        model = ProcessBatchRequest(
            author_name="Reviewer",
            edits=[DocumentEditSchema(target_text="a", new_text="b")],
        )
        jsonschema.validate(_wire(model), _load_schema(self.SCHEMA))

    def test_actions_only_validates(self):
        model = ProcessBatchRequest(
            author_name="Reviewer",
            actions=[
                ReviewActionSchema(
                    action=ReviewActionType.ACCEPT, target_id="Chg:1"
                ),
                ReviewActionSchema(
                    action=ReviewActionType.REPLY, target_id="Com:5", text="done"
                ),
            ],
        )
        jsonschema.validate(_wire(model), _load_schema(self.SCHEMA))

    def test_bare_request_validates(self):
        # edits/actions omitted -> serialized as null; the route rejects this
        # with its own 422, but the wire shape itself is schema-legal.
        model = ProcessBatchRequest(author_name="Reviewer")
        jsonschema.validate(_wire(model), _load_schema(self.SCHEMA))

    def test_all_review_action_types_are_schema_legal(self):
        for action in ReviewActionType:
            model = ProcessBatchRequest(
                author_name="Reviewer",
                actions=[ReviewActionSchema(action=action, target_id="Chg:1")],
            )
            jsonschema.validate(_wire(model), _load_schema(self.SCHEMA))


# ── document-editor.batch-summary (X-Batch-Summary header payload) ──────────

class TestBatchSummaryContract:
    SCHEMA = "document-editor.batch-summary.schema.json"

    def test_summary_validates(self):
        model = BatchSummary(
            applied_edits=2, skipped_edits=0, applied_actions=1, skipped_actions=0
        )
        jsonschema.validate(_wire(model), _load_schema(self.SCHEMA))

    def test_negative_count_rejected_by_schema(self):
        model = BatchSummary(
            applied_edits=-1, skipped_edits=0, applied_actions=0, skipped_actions=0
        )
        with pytest.raises(jsonschema.ValidationError):
            jsonschema.validate(_wire(model), _load_schema(self.SCHEMA))


# ── document-editor.read-docx-response ──────────────────────────────────────

class TestReadDocxResponseContract:
    SCHEMA = "document-editor.read-docx-response.schema.json"

    def test_response_validates(self):
        model = ReadDocxResponse(text="Hello world.", filename="test.docx")
        jsonschema.validate(_wire(model), _load_schema(self.SCHEMA))


# ── document-editor.apply-edits-markdown-{request,response} ─────────────────

class TestApplyEditsMarkdownContract:
    REQUEST_SCHEMA = "document-editor.apply-edits-markdown-request.schema.json"
    RESPONSE_SCHEMA = "document-editor.apply-edits-markdown-response.schema.json"

    def test_request_with_defaults_validates(self):
        model = ApplyEditsMarkdownRequest(
            edits=[DocumentEditSchema(target_text="a", new_text="b")]
        )
        payload = _wire(model)
        assert payload["highlight_only"] is False
        assert payload["include_index"] is False
        jsonschema.validate(payload, _load_schema(self.REQUEST_SCHEMA))

    def test_request_with_flags_validates(self):
        model = ApplyEditsMarkdownRequest(
            edits=[DocumentEditSchema(target_text="a", new_text="b")],
            highlight_only=True,
            include_index=True,
        )
        jsonschema.validate(_wire(model), _load_schema(self.REQUEST_SCHEMA))

    def test_response_validates(self):
        model = ApplyEditsMarkdownResponse(markdown="{--a--}{++b++}")
        jsonschema.validate(_wire(model), _load_schema(self.RESPONSE_SCHEMA))


# ── document-editor.diff-response ───────────────────────────────────────────

class TestDiffResponseContract:
    SCHEMA = "document-editor.diff-response.schema.json"

    def test_no_differences_validates(self):
        model = DiffResponse(diff="", has_differences=False)
        jsonschema.validate(_wire(model), _load_schema(self.SCHEMA))

    def test_with_differences_validates(self):
        model = DiffResponse(diff="- old\n+ new", has_differences=True)
        jsonschema.validate(_wire(model), _load_schema(self.SCHEMA))


# ── document-editor.error-response ──────────────────────────────────────────

class TestErrorResponseContract:
    SCHEMA = "document-editor.error-response.schema.json"

    def test_detail_only_validates(self):
        model = ErrorResponse(detail="Invalid DOCX file")
        jsonschema.validate(_wire(model), _load_schema(self.SCHEMA))

    def test_detail_with_errors_validates(self):
        model = ErrorResponse(
            detail="Batch rejected", errors=["target text not found: 'x'"]
        )
        jsonschema.validate(_wire(model), _load_schema(self.SCHEMA))
