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

from . import USER_AGENT

HOST_DELAY_SECONDS = 1.0
MAX_CRAWL_DELAY_SECONDS = 30.0
MAX_RETRY_AFTER_SECONDS = 60.0
RETRY_STATUSES = {429, 500, 502, 503, 504}
PAGE_BYTES = 8_000_000


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
    time per host; 429 and 5xx are retried after the wait the server asks for."""

    def __init__(self, delay: float = HOST_DELAY_SECONDS) -> None:
        self.delay = delay
        self.lock = threading.Lock()
        self.host_locks: dict[str, threading.Lock] = {}
        self.last_request: dict[str, float] = {}
        self.robots: dict[str, RobotFileParser] = {}
        self.context = ssl.create_default_context()

    def host_lock(self, host: str) -> threading.Lock:
        with self.lock:
            return self.host_locks.setdefault(host, threading.Lock())

    def host_delay(self, url: str) -> float:
        parsed = urlparse(url)
        robots = self.robots.get(f"{parsed.scheme}://{parsed.netloc}")
        requested = robots.crawl_delay(USER_AGENT) if robots else None
        return max(self.delay, min(float(requested or 0), MAX_CRAWL_DELAY_SECONDS))

    def get(self, url: str, attempts: int = 3, max_bytes: int = PAGE_BYTES) -> Response:
        host = urlparse(url).netloc.lower()
        for attempt in range(attempts):
            backoff = 2.0 ** (attempt + 1)
            with self.host_lock(host):
                wait = self.last_request.get(host, 0.0) + self.host_delay(url) - time.monotonic()
                if wait > 0:
                    time.sleep(wait)
                try:
                    request = Request(
                        url,
                        headers={
                            "User-Agent": USER_AGENT,
                            "Accept": "text/html,application/xhtml+xml,application/json,image/*;q=0.9,*/*;q=0.8",
                            "Accept-Language": "en",
                        },
                    )
                    with urlopen(request, timeout=25, context=self.context) as response:
                        return Response(response.geturl(), response.read(max_bytes), response.headers.get("Content-Type", ""))
                except HTTPError as error:
                    if error.code not in RETRY_STATUSES or attempt == attempts - 1:
                        raise
                    retry_after = (error.headers.get("Retry-After") or "").strip()
                    if retry_after.isdigit():
                        backoff = min(float(retry_after), MAX_RETRY_AFTER_SECONDS)
                except (URLError, TimeoutError, ConnectionError):
                    if attempt == attempts - 1:
                        raise
                finally:
                    self.last_request[host] = time.monotonic()
            time.sleep(backoff)
        raise AssertionError("unreachable")

    def allowed(self, url: str) -> bool:
        parsed = urlparse(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin not in self.robots:
            parser = RobotFileParser()
            try:
                parser.parse(self.get(origin + "/robots.txt", attempts=1).text().splitlines())
            except HTTPError as error:
                if error.code in {401, 403}:
                    parser.disallow_all = True
                else:
                    parser.allow_all = True
            except Exception:
                parser.allow_all = True
            self.robots[origin] = parser
        return self.robots[origin].can_fetch(USER_AGENT, url)

    def fetch(self, url: str, attempts: int = 3, max_bytes: int = PAGE_BYTES) -> Response:
        if not self.allowed(url):
            raise PermissionError("robots.txt disallows this URL")
        return self.get(url, attempts=attempts, max_bytes=max_bytes)


def unreachable(error: Exception) -> tuple[str, str]:
    """Report label and the detail stored with an inaccessible observation."""
    if isinstance(error, PermissionError):
        return "robots-skip", "robots.txt disallows a refresh of this URL. The stored excerpt was kept."
    return "fetch-failed", "The page could not be fetched. The stored excerpt and last successful check were kept."
