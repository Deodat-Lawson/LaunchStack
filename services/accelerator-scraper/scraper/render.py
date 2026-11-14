"""Headless render, used only when static HTML has too little visible text.

Playwright is optional. If it is not installed the caller records that and keeps going.
Rendered HTML is cached on disk so a second run does not launch a browser.
"""

from __future__ import annotations

import threading

from . import USER_AGENT
from .cache import HttpCache
from .net import Fetcher

_LOCK = threading.Lock()
_MISSING: bool | None = None


def rendered_html(url: str, cache: HttpCache) -> tuple[str | None, str | None]:
    """Return (html, gap). gap is playwright_missing or render_failed when html is None."""
    cached = cache.load(url, rendered=True)
    if cached:
        return cached["body"].decode("utf-8", "replace"), None
    html, gap = _render(url)
    if html:
        cache.store(url, html.encode("utf-8"), "text/html; charset=utf-8", None, None, url, rendered=True)
    return html, gap


def _render(url: str) -> tuple[str | None, str | None]:
    global _MISSING
    if _MISSING:
        return None, "playwright_missing"
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        _MISSING = True
        return None, "playwright_missing"
    try:
        with _LOCK:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                try:
                    page = browser.new_page()
                    page.goto(url, wait_until="domcontentloaded", timeout=20000)
                    page.wait_for_timeout(400)
                    return page.content(), None
                finally:
                    browser.close()
    except Exception:
        return None, "render_failed"


def browser_fetch(url: str) -> tuple[str, bytes, str]:
    """GET one URL through headless Chromium with TLS verification on, as LaunchStack's crawler.
    Returns (final URL, body, content type); an HTTP error status raises HTTPError."""
    from urllib.error import HTTPError

    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise RuntimeError("certificate chain incomplete and Playwright is not installed") from error
    with _LOCK:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                page = browser.new_page(user_agent=USER_AGENT)
                response = page.goto(url, wait_until="domcontentloaded", timeout=25000)
                if response is None:
                    raise RuntimeError("no response")
                if response.status >= 400:
                    raise HTTPError(url, response.status, response.status_text, None, None)  # type: ignore[arg-type]
                return page.url, response.body(), response.headers.get("content-type", "")
            finally:
                browser.close()


def render_gap_for(fetcher: Fetcher, url: str) -> tuple[str | None, str | None]:
    return rendered_html(url, fetcher.cache)
