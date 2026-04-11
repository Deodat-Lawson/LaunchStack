"""
Bug Condition Exploration Tests — Sidecar ADEU Routes

Property 1: Expected Behavior — ADEU Review Fixes
Tests in this file verify bugs 1.5, 1.6, 1.7, 1.10 are FIXED.
They PASS on fixed code, confirming each bug has been resolved.
"""

import io
import json

import pytest
from docx import Document
from fastapi.testclient import TestClient


# ===========================================================================
# Fix 1.5 — Async routes wrap sync adeu calls in asyncio.to_thread
# ===========================================================================


class TestFix1_5_AsyncioToThread:
    """Fix 1.5: async routes now wrap synchronous adeu functions in
    asyncio.to_thread(), preventing event loop blocking."""

    def test_sync_adeu_calls_wrapped_in_to_thread(self):
        """Inspect the route source to confirm sync calls ARE wrapped
        in asyncio.to_thread()."""
        import inspect
        from app.routes.adeu import read_docx, process_batch, accept_all, diff_docx

        for fn_name, fn in [
            ("read_docx", read_docx),
            ("process_batch", process_batch),
            ("accept_all", accept_all),
            ("diff_docx", diff_docx),
        ]:
            source = inspect.getsource(fn)
            # FIX: The async route wraps sync adeu calls in asyncio.to_thread().
            assert "asyncio.to_thread" in source, (
                f"{fn_name} does not use asyncio.to_thread — bug 1.5 not fixed"
            )

    def test_routes_are_async(self):
        """Verify routes are declared async."""
        import inspect
        from app.routes.adeu import read_docx, process_batch, accept_all, diff_docx

        for fn_name, fn in [
            ("read_docx", read_docx),
            ("process_batch", process_batch),
            ("accept_all", accept_all),
            ("diff_docx", diff_docx),
        ]:
            assert inspect.iscoroutinefunction(fn), (
                f"{fn_name} should be async"
            )


# ===========================================================================
# Fix 1.6 — Upload size validation rejects oversized files with 413
# ===========================================================================


class TestFix1_6_UploadSizeValidation:
    """Fix 1.6: Sidecar now validates upload size and returns 413 for
    files exceeding the configured maximum."""

    def test_max_upload_size_constant_exists_in_routes(self):
        """Confirm MAX_UPLOAD_SIZE check is present in the route module."""
        import inspect
        import app.routes.adeu as adeu_module

        source = inspect.getsource(adeu_module)
        # FIX: Size validation exists
        assert "MAX_UPLOAD_SIZE" in source
        assert "413" in source

    def test_oversized_upload_rejected_with_413(self, client, simple_docx):
        """A file exceeding 50 MB is rejected with 413."""
        # Pad to just over 50 MB
        padding = b"\x00" * (50 * 1024 * 1024 + 1)
        oversized = simple_docx + padding

        resp = client.post(
            "/adeu/read",
            files={"file": ("huge.docx", oversized)},
        )

        # FIX: The server rejects the oversized upload with 413.
        assert resp.status_code == 413, (
            f"Expected 413 for oversized upload, got {resp.status_code}"
        )


# ===========================================================================
# Fix 1.7 — Generic error responses, no internal detail leakage
# ===========================================================================


class TestFix1_7_GenericErrorResponses:
    """Fix 1.7: Exception handlers now return generic 'Internal server error'
    instead of leaking internal exception details."""

    def test_error_handler_uses_generic_message(self):
        """Confirm the source code uses generic error message, not f-string with exc."""
        import inspect
        import app.routes.adeu as adeu_module

        source = inspect.getsource(adeu_module)
        # FIX: No f-string with exception details in response
        assert 'f"Internal error: {exc}"' not in source
        # FIX: Generic message is used instead
        assert "Internal server error" in source

    def test_error_response_does_not_leak_exception_details(self, client):
        """Trigger an exception and verify the response does NOT leak internal details."""
        # Send invalid bytes that will cause an exception in adeu
        resp = client.post(
            "/adeu/read",
            files={"file": ("bad.docx", b"not a real docx file at all")},
        )

        # The response should be a 422 or 500
        assert resp.status_code in (422, 500)
        body = resp.json()

        # FIX: The error detail should NOT contain internal exception details
        detail = body.get("detail", "")
        assert "Internal error:" not in detail
        # Should be a generic message
        assert detail in ("Internal server error", "Invalid DOCX file") or \
               detail.startswith("Invalid DOCX")


# ===========================================================================
# Fix 1.10 — Filename sanitization in Content-Disposition headers
# ===========================================================================


class TestFix1_10_FilenameSanitization:
    """Fix 1.10: Filenames with special characters are now sanitized before
    being inserted into Content-Disposition headers."""

    def test_sanitize_filename_function_exists_in_routes(self):
        """Confirm sanitize_filename function is present in the route module."""
        import inspect
        import app.routes.adeu as adeu_module

        source = inspect.getsource(adeu_module)
        # FIX: Sanitization function exists
        assert "sanitize_filename" in source
        assert "re.sub" in source

    def test_filename_with_crlf_is_sanitized_in_content_disposition(self, client, simple_docx):
        """A filename containing \\r\\n is sanitized in Content-Disposition."""
        malicious_filename = "report\r\nX-Injected: evil"

        resp = client.post(
            "/adeu/accept-all",
            files={"file": (malicious_filename, simple_docx)},
        )

        # The request should succeed (200)
        assert resp.status_code == 200

        content_disp = resp.headers.get("content-disposition", "")
        # FIX: The CRLF characters should be replaced with underscores.
        # The raw \r\n should NOT appear in the header.
        assert "\r" not in content_disp
        assert "\n" not in content_disp

    def test_filename_with_quotes_is_sanitized(self, client, simple_docx):
        """A filename with double quotes is sanitized in Content-Disposition."""
        malicious_filename = 'report"; malicious=true; x="'

        resp = client.post(
            "/adeu/accept-all",
            files={"file": (malicious_filename, simple_docx)},
        )

        assert resp.status_code == 200
        content_disp = resp.headers.get("content-disposition", "")
        # FIX: The semicolons and quotes should be replaced with underscores.
        # The injection should not create a new Content-Disposition parameter.
        # The header should only have one parameter (filename), not multiple.
        # A successful injection would produce: attachment; filename="report"; malicious=true; x=""
        # After sanitization, the semicolons are replaced so it stays as one filename value.
        # Verify the header doesn't have a standalone "malicious" parameter (outside quotes)
        # by checking the structure: after the closing quote of filename, there should be nothing
        # that looks like a new parameter injection.
        assert '; malicious=' not in content_disp
