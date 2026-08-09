"""
Host allowlist for /download-and-transcribe (ADR-004 §6).

The route hands the request URL to yt-dlp, which will happily fetch from
anywhere — cloud metadata endpoints, internal services, the host itself. So
before yt-dlp ever sees a URL it must:

- use an http(s) scheme (no file://, ftp://, data:, ...);
- name a real DNS host — literal IPs and localhost are rejected outright;
- match the configured allowlist (``TRANSCRIPTION_ALLOWED_HOSTS``) on a
  dot boundary: ``youtube.com`` allows ``youtube.com`` and
  ``www.youtube.com`` but NOT ``evil-youtube.com``.

Every rejection is a 403 with a detail that names the env var, so operators
can tell a policy rejection from a download failure.
"""

import ipaddress
from urllib.parse import urlsplit

from fastapi import HTTPException


def _forbidden(detail: str) -> HTTPException:
    return HTTPException(status_code=403, detail=detail)


def validate_download_url(url: str, allowed_hosts: tuple[str, ...]) -> None:
    """Raise HTTPException(403) unless ``url`` passes the download policy."""
    try:
        parts = urlsplit(url)
        host = parts.hostname  # lowercased; strips IPv6 brackets and port
    except ValueError:
        raise _forbidden(
            "URL could not be parsed; only http(s) URLs on hosts allowed by "
            "TRANSCRIPTION_ALLOWED_HOSTS are accepted"
        ) from None

    scheme = (parts.scheme or "").lower()
    if scheme not in ("http", "https"):
        raise _forbidden(
            f"URL scheme {scheme or '(none)'!r} is not allowed; only http and "
            "https URLs are accepted"
        )

    if not host:
        raise _forbidden(
            "URL has no host; only http(s) URLs on hosts allowed by "
            "TRANSCRIPTION_ALLOWED_HOSTS are accepted"
        )

    # Trailing-dot FQDN form ("youtube.com.") normalizes to the same host.
    host = host.rstrip(".")

    if host == "localhost" or host.endswith(".localhost"):
        raise _forbidden("localhost URLs are not allowed")

    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass  # not an IP literal — the normal case
    else:
        raise _forbidden(
            "literal IP addresses are not allowed; use a hostname permitted "
            "by TRANSCRIPTION_ALLOWED_HOSTS"
        )

    # Suffix match on a dot boundary ONLY — "evil-youtube.com" must never
    # match the "youtube.com" entry.
    for suffix in allowed_hosts:
        if host == suffix or host.endswith("." + suffix):
            return

    raise _forbidden(
        f"host {host!r} is not an allowed download source; allowed hosts are "
        "configured via TRANSCRIPTION_ALLOWED_HOSTS"
    )
