"""
Host-allowlist policy for /download-and-transcribe (ADR-004 §6).

The URL must be validated BEFORE yt-dlp sees it: http(s) schemes only, no
literal-IP hosts, no localhost, and the host must match
TRANSCRIPTION_ALLOWED_HOSTS on a dot boundary. Every rejection is a 403.
"""

import pytest
from fastapi import HTTPException

import app.routes.download_and_transcribe as dl_module
from app.config import DEFAULT_ALLOWED_HOSTS, load_config
from app.main import app
from app.url_policy import validate_download_url

ALLOWED = ("youtube.com", "youtu.be")


# ── Unit tests of the validator ─────────────────────────────────────────────

class TestValidateDownloadUrl:
    @pytest.mark.parametrize(
        "url",
        [
            "https://youtube.com/watch?v=abc",
            "https://www.youtube.com/watch?v=abc",
            "http://YOUTU.BE/abc",  # scheme + host case-insensitive
            "https://m.youtube.com./watch?v=abc",  # trailing-dot FQDN form
        ],
    )
    def test_allowed_hosts_pass(self, url):
        assert validate_download_url(url, ALLOWED) is None

    def test_suffix_match_is_dot_boundary_safe(self):
        """evil-youtube.com must NOT match the youtube.com entry."""
        with pytest.raises(HTTPException) as exc:
            validate_download_url("https://evil-youtube.com/watch?v=abc", ALLOWED)
        assert exc.value.status_code == 403

    @pytest.mark.parametrize(
        "url",
        [
            "https://notyoutube.com/x",
            "https://youtube.com.evil.example/x",  # allowlisted name as prefix
            "https://vimeo.com/123",  # not in THIS test's allowlist
        ],
    )
    def test_disallowed_hosts_rejected_with_403(self, url):
        with pytest.raises(HTTPException) as exc:
            validate_download_url(url, ALLOWED)
        assert exc.value.status_code == 403

    def test_disallowed_host_detail_names_the_env_var(self):
        with pytest.raises(HTTPException) as exc:
            validate_download_url("https://example.com/v", ALLOWED)
        assert "TRANSCRIPTION_ALLOWED_HOSTS" in exc.value.detail

    @pytest.mark.parametrize(
        "url",
        [
            "https://192.168.1.10/video",
            "http://169.254.169.254/latest/meta-data/",  # cloud metadata
            "http://[::1]/video",
            "http://[2001:db8::1]/video",
        ],
    )
    def test_ip_literals_rejected_with_403(self, url):
        with pytest.raises(HTTPException) as exc:
            validate_download_url(url, ALLOWED)
        assert exc.value.status_code == 403

    @pytest.mark.parametrize(
        "url",
        ["http://localhost/video", "http://localhost:8000/video",
         "http://foo.localhost/video"],
    )
    def test_localhost_rejected_with_403(self, url):
        with pytest.raises(HTTPException) as exc:
            validate_download_url(url, ALLOWED)
        assert exc.value.status_code == 403

    @pytest.mark.parametrize(
        "url",
        [
            "file:///etc/passwd",
            "ftp://youtube.com/video",
            "youtube.com/watch?v=abc",  # no scheme
            "https:///no-host",
        ],
    )
    def test_non_http_or_hostless_urls_rejected_with_403(self, url):
        with pytest.raises(HTTPException) as exc:
            validate_download_url(url, ALLOWED)
        assert exc.value.status_code == 403


# ── Config parsing ──────────────────────────────────────────────────────────

class TestAllowedHostsConfig:
    def test_default_allowlist_covers_the_advertised_platforms(self):
        config = load_config()
        assert config.allowed_hosts == DEFAULT_ALLOWED_HOSTS
        assert config.allowed_hosts == (
            "youtube.com", "youtu.be", "vimeo.com",
            "twitter.com", "x.com", "tiktok.com",
        )

    def test_env_override_is_parsed_and_normalized(self, monkeypatch):
        monkeypatch.setenv(
            "TRANSCRIPTION_ALLOWED_HOSTS", " Example.com, .media.internal ,,"
        )
        config = load_config()
        assert config.allowed_hosts == ("example.com", "media.internal")

    def test_all_separator_junk_is_a_startup_error(self, monkeypatch):
        monkeypatch.setenv("TRANSCRIPTION_ALLOWED_HOSTS", " , ,")
        with pytest.raises(ValueError, match="TRANSCRIPTION_ALLOWED_HOSTS"):
            load_config()


# ── Route behaviour (downloader mocked — no network, no yt-dlp) ─────────────

class TestDownloadRoutePolicy:
    def test_allowed_host_passes_validation(self, client, monkeypatch, tmp_path):
        """A youtube.com URL gets past the policy and into the downloader."""
        audio = tmp_path / "abc.mp3"
        audio.write_bytes(b"fake-mp3")
        calls: list[str] = []

        def fake_download(url, output_dir, max_duration):
            calls.append(url)
            return {"filepath": str(audio), "title": "A Video", "duration": 12.5}

        monkeypatch.setattr(dl_module, "_download_audio", fake_download)

        resp = client.post(
            "/download-and-transcribe",
            json={"url": "https://www.youtube.com/watch?v=abc"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["title"] == "A Video"
        assert body["source_url"] == "https://www.youtube.com/watch?v=abc"
        assert calls == ["https://www.youtube.com/watch?v=abc"]

    def test_disallowed_host_is_403_and_downloader_never_runs(
        self, client, monkeypatch
    ):
        def explode(*args, **kwargs):  # pragma: no cover - must not run
            raise AssertionError("downloader must not be called for a 403 URL")

        monkeypatch.setattr(dl_module, "_download_audio", explode)

        resp = client.post(
            "/download-and-transcribe",
            json={"url": "https://evil-youtube.com/watch?v=abc"},
        )
        assert resp.status_code == 403
        assert "TRANSCRIPTION_ALLOWED_HOSTS" in resp.json()["detail"]

    def test_ip_literal_is_403(self, client, monkeypatch):
        def explode(*args, **kwargs):  # pragma: no cover - must not run
            raise AssertionError("downloader must not be called for a 403 URL")

        monkeypatch.setattr(dl_module, "_download_audio", explode)

        resp = client.post(
            "/download-and-transcribe",
            json={"url": "http://169.254.169.254/latest/meta-data/"},
        )
        assert resp.status_code == 403

    def test_env_allowlist_governs_the_route(self, client, monkeypatch, tmp_path):
        """TRANSCRIPTION_ALLOWED_HOSTS replaces the default allowlist."""
        monkeypatch.setenv("TRANSCRIPTION_ALLOWED_HOSTS", "media.internal")
        app.state.config = load_config()

        resp = client.post(
            "/download-and-transcribe",
            json={"url": "https://www.youtube.com/watch?v=abc"},
        )
        assert resp.status_code == 403

        audio = tmp_path / "abc.mp3"
        audio.write_bytes(b"fake-mp3")
        monkeypatch.setattr(
            dl_module,
            "_download_audio",
            lambda url, output_dir, max_duration: {
                "filepath": str(audio), "title": "T", "duration": 1.0
            },
        )
        resp = client.post(
            "/download-and-transcribe",
            json={"url": "https://cdn.media.internal/clip"},
        )
        assert resp.status_code == 200
