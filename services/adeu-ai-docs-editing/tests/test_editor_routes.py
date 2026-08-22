"""
Routes added for the Word editor: review-item enumeration, per-edit batch
reporting, reject-all, and object references.
"""

import base64
import io
import json

import pytest
from docx import Document


def _docx(*paragraphs: str) -> bytes:
    doc = Document()
    for text in paragraphs:
        doc.add_paragraph(text)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


@pytest.fixture
def contract_bytes() -> bytes:
    return _docx(
        "The Term of this Agreement shall be twelve (12) months.",
        "Governing law shall be the laws of Delaware.",
    )


def _file(raw: bytes, name: str = "doc.docx"):
    return {"file": (name, io.BytesIO(raw), "application/octet-stream")}


def _redlined(client, auth_headers, raw: bytes) -> bytes:
    """Apply two tracked edits and return the resulting document."""
    body = json.dumps(
        {
            "author_name": "Legal Review Assistant",
            "edits": [
                {
                    "target_text": "twelve (12) months",
                    "new_text": "twenty-four (24) months",
                    "comment": "Extended per negotiation",
                },
                {"target_text": "Delaware", "new_text": "New York"},
            ],
        }
    )
    resp = client.post(
        "/adeu/process-batch",
        files=_file(raw),
        data={"body": body},
        headers={**auth_headers, "Accept": "application/json"},
    )
    assert resp.status_code == 200, resp.text
    return base64.b64decode(resp.json()["document_base64"])


class TestReviewItems:
    def test_requires_auth(self, client_no_auth, contract_bytes):
        resp = client_no_auth.post("/adeu/review-items", files=_file(contract_bytes))
        assert resp.status_code == 401

    def test_clean_document_has_no_items(self, client, auth_headers, contract_bytes):
        resp = client.post("/adeu/review-items", files=_file(contract_bytes), headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["items"] == []
        assert body["change_count"] == 0
        assert body["comment_count"] == 0

    def test_lists_changes_with_addressable_ids(self, client, auth_headers, contract_bytes):
        """The point of the route: ids that round-trip into a review action."""
        edited = _redlined(client, auth_headers, contract_bytes)
        resp = client.post("/adeu/review-items", files=_file(edited), headers=auth_headers)
        assert resp.status_code == 200
        body = resp.json()

        assert body["change_count"] >= 2
        assert all(i["id"].startswith(("Chg:", "Com:")) for i in body["items"])
        assert "Legal Review Assistant" in body["authors"]

    def test_replacement_halves_are_paired(self, client, auth_headers, contract_bytes):
        edited = _redlined(client, auth_headers, contract_bytes)
        items = client.post(
            "/adeu/review-items", files=_file(edited), headers=auth_headers
        ).json()["items"]

        deletes = [i for i in items if i["kind"] == "delete"]
        assert deletes, "expected at least one deletion"
        for item in deletes:
            assert item["paired_with"], f"{item['id']} should pair with its insertion"

    def test_ids_are_accepted_back_as_review_actions(
        self, client, auth_headers, contract_bytes
    ):
        """End-to-end proof that enumeration closes the review loop."""
        edited = _redlined(client, auth_headers, contract_bytes)
        items = client.post(
            "/adeu/review-items", files=_file(edited), headers=auth_headers
        ).json()["items"]
        target = next(i for i in items if i["kind"] in {"insert", "delete"})

        resp = client.post(
            "/adeu/process-batch",
            files=_file(edited),
            data={
                "body": json.dumps(
                    {
                        "author_name": "Reviewer",
                        "actions": [{"action": "ACCEPT", "target_id": target["id"]}],
                    }
                )
            },
            headers={**auth_headers, "Accept": "application/json"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["result"]["summary"]["applied_actions"] >= 1


class TestPerEditReporting:
    def test_json_mode_returns_a_report_per_edit(self, client, auth_headers, contract_bytes):
        body = json.dumps(
            {
                "author_name": "Author",
                "edits": [
                    {"target_text": "twelve (12) months", "new_text": "36 months"},
                    {"target_text": "Delaware", "new_text": "New York"},
                ],
            }
        )
        resp = client.post(
            "/adeu/process-batch",
            files=_file(contract_bytes),
            data={"body": body},
            headers={**auth_headers, "Accept": "application/json"},
        )
        assert resp.status_code == 200, resp.text
        result = resp.json()["result"]
        assert len(result["edits"]) == 2
        assert result["summary"]["applied_edits"] == 2
        assert result["adeu_version"]

    def test_binary_mode_still_carries_the_frozen_summary_header(
        self, client, auth_headers, contract_bytes
    ):
        body = json.dumps(
            {
                "author_name": "Author",
                "edits": [{"target_text": "Delaware", "new_text": "New York"}],
            }
        )
        resp = client.post(
            "/adeu/process-batch",
            files=_file(contract_bytes),
            data={"body": body},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        summary = json.loads(resp.headers["X-Batch-Summary"])
        assert summary["applied_edits"] == 1

    def test_partial_salvages_the_valid_edits(self, client, auth_headers, contract_bytes):
        """Without `partial`, one bad target rejects the batch. With it, the
        good edits land and the failure is reported rather than hidden."""
        body = json.dumps(
            {
                "author_name": "Author",
                "partial": True,
                "edits": [
                    {"target_text": "Delaware", "new_text": "New York"},
                    {"target_text": "no such text anywhere", "new_text": "x"},
                ],
            }
        )
        resp = client.post(
            "/adeu/process-batch",
            files=_file(contract_bytes),
            data={"body": body},
            headers={**auth_headers, "Accept": "application/json"},
        )
        assert resp.status_code == 200, resp.text
        result = resp.json()["result"]
        assert result["summary"]["applied_edits"] == 1
        assert result["failed"], "the unmatched edit should be reported, not dropped"

    def test_all_or_nothing_is_still_the_default(self, client, auth_headers, contract_bytes):
        body = json.dumps(
            {
                "author_name": "Author",
                "edits": [
                    {"target_text": "Delaware", "new_text": "New York"},
                    {"target_text": "no such text anywhere", "new_text": "x"},
                ],
            }
        )
        resp = client.post(
            "/adeu/process-batch",
            files=_file(contract_bytes),
            data={"body": body},
            headers=auth_headers,
        )
        assert resp.status_code == 422
        assert resp.json()["errors"]


class TestRejectAll:
    def test_requires_auth(self, client_no_auth, contract_bytes):
        resp = client_no_auth.post("/adeu/reject-all", files=_file(contract_bytes))
        assert resp.status_code == 401

    def test_restores_the_original_text(self, client, auth_headers, contract_bytes):
        edited = _redlined(client, auth_headers, contract_bytes)

        resp = client.post("/adeu/reject-all", files=_file(edited), headers=auth_headers)
        assert resp.status_code == 200

        restored = resp.content
        text = client.post(
            "/adeu/read",
            files=_file(restored),
            data={"clean_view": "true"},
            headers=auth_headers,
        ).json()["text"]

        assert "Delaware" in text
        assert "New York" not in text


class TestAcceptAllComments:
    def test_comments_are_removed_by_default(self, client, auth_headers, contract_bytes):
        """adeu 2.4 defaults `remove_comments` to False; this service has always
        produced a fully clean document, so it opts back in."""
        edited = _redlined(client, auth_headers, contract_bytes)
        resp = client.post("/adeu/accept-all", files=_file(edited), headers=auth_headers)
        assert resp.status_code == 200

        text = client.post(
            "/adeu/read", files=_file(resp.content), headers=auth_headers
        ).json()["text"]
        assert "Extended per negotiation" not in text

    def test_comments_can_be_kept(self, client, auth_headers, contract_bytes):
        edited = _redlined(client, auth_headers, contract_bytes)
        resp = client.post(
            "/adeu/accept-all",
            files=_file(edited),
            data={"body": json.dumps({"remove_comments": False})},
            headers=auth_headers,
        )
        assert resp.status_code == 200

        text = client.post(
            "/adeu/read", files=_file(resp.content), headers=auth_headers
        ).json()["text"]
        assert "Extended per negotiation" in text


def _configure_origins(service_app, origins: tuple[str, ...]) -> None:
    """Install a startup config with a specific allow-list.

    The test client does not run the lifespan, so `state.config` is absent
    until a test puts one there.
    """
    from app.config import ServiceConfig

    service_app.state.config = ServiceConfig(
        api_key_configured=True,
        adeu_available=True,
        adeu_version="2.4.1",
        allowed_fetch_origins=origins,
    )


class TestObjectReferences:
    """ADR-004 §6: only allow-listed origins may be fetched."""

    def test_disabled_when_no_allow_list_is_configured(
        self, client, auth_headers, contract_bytes
    ):
        resp = client.post(
            "/adeu/read",
            data={"body": json.dumps({"source": {"url": "http://example.com/a.docx"}})},
            headers=auth_headers,
        )
        assert resp.status_code == 400
        assert "ALLOWED_FETCH_ORIGINS" in resp.json()["detail"]

    def test_origin_outside_the_allow_list_is_rejected(self, client, auth_headers, service_app):
        _configure_origins(service_app, ("http://app:3000",))
        resp = client.post(
            "/adeu/read",
            data={
                "body": json.dumps({"source": {"url": "http://169.254.169.254/latest/meta-data"}})
            },
            headers=auth_headers,
        )
        assert resp.status_code == 400
        assert "not in ALLOWED_FETCH_ORIGINS" in resp.json()["detail"]

    def test_non_http_scheme_is_rejected(self, client, auth_headers, service_app):
        _configure_origins(service_app, ("http://app:3000",))
        resp = client.post(
            "/adeu/read",
            data={"body": json.dumps({"source": {"url": "file:///etc/passwd"}})},
            headers=auth_headers,
        )
        assert resp.status_code == 400

    def test_upload_and_reference_together_is_rejected(
        self, client, auth_headers, contract_bytes
    ):
        resp = client.post(
            "/adeu/read",
            files=_file(contract_bytes),
            data={"body": json.dumps({"source": {"url": "http://app:3000/x.docx"}})},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    def test_neither_upload_nor_reference_is_rejected(self, client, auth_headers):
        resp = client.post("/adeu/read", data={"body": json.dumps({})}, headers=auth_headers)
        assert resp.status_code == 422
