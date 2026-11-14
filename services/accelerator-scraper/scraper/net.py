"""One polite HTTP client shared by every step."""

from __future__ import annotations

import re
import ssl
import threading
import time
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.robotparser import RobotFileParser

from . import CACHE, USER_AGENT
from .cache import HttpCache
from .parse import Page

HOST_DELAY_SECONDS = 1.0
MAX_CRAWL_DELAY_SECONDS = 30.0
MAX_RETRY_AFTER_SECONDS = 60.0
RETRY_STATUSES = {429, 500, 502, 503, 504}
PAGE_BYTES = 8_000_000


def robots_policy(status: int | None) -> str:
    """RFC 9309 §2.3.1: a 4xx robots.txt is "unavailable" and allows crawling; a 5xx, a 429
    or a network failure is "unreachable" and disallows the whole host."""
    if status is not None and 400 <= status < 500 and status != 429:
        return "allow"
    return "disallow"


class RobotsUnavailable(PermissionError):
    """robots.txt could not be fetched. The URL is disallowed and the page is inaccessible."""


@dataclass
class Response:
    url: str
    body: bytes
    content_type: str

    def text(self) -> str:
        match = re.search(r"charset=([\w-]+)", self.content_type, re.I)
        try:
            return self.body.decode(match.group(1) if match else "utf-8", "replace")
        except LookupError:
            return self.body.decode("utf-8", "replace")


class Fetcher:
    """Anonymous GETs only. robots.txt is honoured, including Crawl-delay; one request at a
    time per host; 429 and 5xx are retried after the wait the server asks for.

    A robots.txt that cannot be reached (5xx, 429, network error) disallows the host; a 4xx one
    allows it (RFC 9309). A site whose certificate chain Python cannot complete is read through
    headless Chromium, which still verifies the certificate. Responses are cached on disk with
    ETag and Last-Modified so a second run reuses the same bytes.
    """

    def __init__(self, delay: float = HOST_DELAY_SECONDS, cache: HttpCache | None = None) -> None:
        self.delay = delay
        self.cache = cache if cache is not None else HttpCache(CACHE)
        self.lock = threading.Lock()
        self.host_locks: dict[str, threading.Lock] = {}
        self.last_request: dict[str, float] = {}
        self.robots: dict[str, RobotFileParser] = {}
        self.robots_failed: dict[str, str] = {}
        self.context = ssl.create_default_context()

    def host_lock(self, host: str) -> threading.Lock:
        with self.lock:
            return self.host_locks.setdefault(host, threading.Lock())

    def host_delay(self, url: str) -> float:
        parsed = urlparse(url)
        robots = self.robots.get(f"{parsed.scheme}://{parsed.netloc}")
        requested = robots.crawl_delay(USER_AGENT) if robots else None
        return max(self.delay, min(float(requested or 0), MAX_CRAWL_DELAY_SECONDS))

    def _conditional_headers(self, cached: dict | None) -> dict[str, str]:
        headers = {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/json,image/*,*/*;q=0.8",
            "Accept-Language": "en",
        }
        if not cached:
            return headers
        if cached.get("etag"):
            headers["If-None-Match"] = cached["etag"]
        if cached.get("last_modified"):
            headers["If-Modified-Since"] = cached["last_modified"]
        return headers

    def get(self, url: str, attempts: int = 3, max_bytes: int = PAGE_BYTES) -> Response:
        host = urlparse(url).netloc.lower()
        cached = self.cache.load(url)
        for attempt in range(attempts):
            backoff = 2.0 ** (attempt + 1)
            with self.host_lock(host):
                wait = self.last_request.get(host, 0.0) + self.host_delay(url) - time.monotonic()
                if wait > 0:
                    time.sleep(wait)
                try:
                    request = Request(url, headers=self._conditional_headers(cached))
                    with urlopen(request, timeout=25, context=self.context) as response:
                        body = response.read(max_bytes)
                        content_type = response.headers.get("Content-Type", "")
                        etag = response.headers.get("ETag")
                        modified = response.headers.get("Last-Modified")
                        final = response.geturl()
                        if cached and _same_visible(cached["body"], cached.get("content_type", ""), body, content_type):
                            self.cache.store(url, cached["body"], cached.get("content_type", content_type), etag, modified, cached.get("final_url", final))
                            return Response(cached.get("final_url", final), cached["body"], cached.get("content_type", content_type))
                        self.cache.store(url, body, content_type, etag, modified, final)
                        return Response(final, body, content_type)
                except HTTPError as error:
                    if error.code == 304 and cached:
                        return Response(cached.get("final_url", url), cached["body"], cached.get("content_type", ""))
                    if error.code not in RETRY_STATUSES or attempt == attempts - 1:
                        raise
                    retry_after = (error.headers.get("Retry-After") or "").strip()
                    if retry_after.isdigit():
                        backoff = min(float(retry_after), MAX_RETRY_AFTER_SECONDS)
                except URLError as error:
                    if isinstance(error.reason, ssl.SSLCertVerificationError):
                        return self._verified_by_browser(url, max_bytes)
                    if attempt == attempts - 1:
                        raise
                except (TimeoutError, ConnectionError):
                    if attempt == attempts - 1:
                        raise
                finally:
                    self.last_request[host] = time.monotonic()
            time.sleep(backoff)
        raise AssertionError("unreachable")

    def _verified_by_browser(self, url: str, max_bytes: int) -> Response:
        """Python's TLS stack does not fetch missing intermediate certificates; Chromium does,
        and verifies the chain. Verification is never switched off."""
        from .render import browser_fetch

        final, body, content_type = browser_fetch(url)
        body = body[:max_bytes]
        self.cache.store(url, body, content_type, None, None, final)
        return Response(final, body, content_type)

    def allowed(self, url: str) -> bool:
        parsed = urlparse(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin not in self.robots:
            parser = RobotFileParser()
            try:
                parser.parse(self.get(origin + "/robots.txt", attempts=1).text().splitlines())
            except HTTPError as error:
                if robots_policy(error.code) == "allow":
                    parser.allow_all = True
                else:
                    parser.disallow_all = True
                    self.robots_failed[origin] = f"robots.txt returned HTTP {error.code}"
            except Exception as error:
                parser.disallow_all = True
                self.robots_failed[origin] = f"robots.txt could not be fetched ({error})"
            self.robots[origin] = parser
        return self.robots[origin].can_fetch(USER_AGENT, url)

    def fetch(self, url: str, attempts: int = 3, max_bytes: int = PAGE_BYTES) -> Response:
        if not self.allowed(url):
            origin = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
            if origin in self.robots_failed:
                raise RobotsUnavailable(self.robots_failed[origin] + ". The page was not fetched.")
            raise PermissionError("robots.txt disallows this URL")
        return self.get(url, attempts=attempts, max_bytes=max_bytes)


def _same_visible(previous: bytes, previous_type: str, new: bytes, new_type: str) -> bool:
    """Same bytes, or the same visible text. Script nonces must not churn a warm cache."""
    if previous == new:
        return True
    if _binary(previous_type) or _binary(new_type) or _binary_body(previous) or _binary_body(new):
        return False
    old = Page.read("https://cache.invalid/", _decode(previous, previous_type)).visible()
    fresh = Page.read("https://cache.invalid/", _decode(new, new_type)).visible()
    return bool(old) and old == fresh


def _binary(content_type: str) -> bool:
    lowered = (content_type or "").lower()
    return lowered.startswith("image/") or "octet-stream" in lowered or "pdf" in lowered


def _binary_body(body: bytes) -> bool:
    return body.startswith((b"\x89PNG", b"\xff\xd8", b"GIF8", b"%PDF", b"RIFF"))


def _decode(body: bytes, content_type: str) -> str:
    match = re.search(r"charset=([\w-]+)", content_type or "", re.I)
    try:
        return body.decode(match.group(1) if match else "utf-8", "replace")
    except LookupError:
        return body.decode("utf-8", "replace")


def unreachable(error: Exception) -> tuple[str, str]:
    """Report label and the detail stored with an inaccessible observation."""
    if isinstance(error, RobotsUnavailable):
        return "robots-unavailable", "robots.txt could not be fetched, so the page was treated as disallowed. The stored excerpt was kept."
    if isinstance(error, PermissionError):
        return "robots-skip", "robots.txt disallows a refresh of this URL. The stored excerpt was kept."
    return "fetch-failed", "The page could not be fetched. The stored excerpt and last successful check were kept."
