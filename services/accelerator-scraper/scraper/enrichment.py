"""Read a Program's official pages and record what they state.

The homepage, sitemap URLs, and same-site links are classified (apply, faq, program,
terms, dates, eligibility, about, and the older portfolio/batch buckets). At most
15 pages are fetched. A page whose static HTML is too thin is rendered when
Playwright is installed; otherwise that gap is recorded and the static text is kept.
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from . import CHECKS, DISCOVERIES, iso
from .facts import Findings, classify, evidence_id, same_site
from .net import Fetcher
from .parse import Page
from .quotes import read
from .records import write_if_changed
from .text import clip

MAX_PAGES = 15
SITEMAP_URLS = 400
PRIORITY = {"application": 0, "terms": 1, "batches": 2, "details": 3, "portfolio": 4}
LOC = re.compile(r"<loc>\s*([^<]+)\s*</loc>", re.I)


def linked_pages(program: dict, page: Page) -> list[tuple[str, str, str]]:
    """Same-site links classified by kind (details, terms, portfolio, batches, application)."""
    seeds = [program["websiteUrl"], program["applyUrl"]]
    pages: list[tuple[str, str, str]] = []
    seen = {program["websiteUrl"].rstrip("/")}
    for anchor in page.anchors:
        href = anchor.href.split("#")[0]
        if urlparse(href).scheme not in {"http", "https"} or not same_site(href, seeds):
            continue
        key = href.rstrip("/")
        kind = classify(href, anchor.text)
        if key in seen or kind == "other":
            continue
        seen.add(key)
        pages.append((href, kind, anchor.text[:180]))
    return pages


def blocked_reason(error: Exception) -> str:
    return "robots" if isinstance(error, PermissionError) else "fetch_failed"


def _empty_checks(program: dict, now: datetime, pages: list[str]) -> dict:
    findings = Findings(program, now.date())
    return {
        "programId": program["id"],
        "checkedAt": iso(now),
        "pagesRead": pages,
        "evidence": [],
        "pageQuotes": [],
        "findings": findings.found,
    }


def _sitemap_candidates(fetcher: Fetcher, origin: str, seeds: list[str]) -> list[tuple[str, str]]:
    queue = [origin + "/sitemap.xml"]
    try:
        robots = fetcher.get(origin + "/robots.txt", attempts=1).text()
        for line in robots.splitlines():
            if line.lower().startswith("sitemap:"):
                queue.append(line.split(":", 1)[1].strip())
    except Exception:
        pass
    found: list[tuple[str, str]] = []
    seen: set[str] = set()
    while queue and len(seen) < 8 and len(found) < SITEMAP_URLS:
        url = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        try:
            body = fetcher.fetch(url, attempts=1, max_bytes=2_000_000).text()
        except Exception:
            continue
        locs = [item.strip() for item in LOC.findall(body)]
        if "<sitemapindex" in body[:800].lower() or any(item.lower().endswith(".xml") for item in locs[:3]):
            queue.extend(item for item in locs if item.lower().endswith(".xml"))
            continue
        for loc in locs:
            kind = classify(loc, "")
            if kind != "other" and same_site(loc, seeds):
                found.append((loc.split("#")[0], kind))
    return found


def enrich(program: dict, fetcher: Fetcher, now: datetime) -> tuple[dict | None, dict]:
    """The checks record (None when a previous one should be kept) and the discovery record."""
    findings = Findings(program, now.date())
    discovery: dict = {"programId": program["id"], "checkedAt": iso(now), "pages": []}
    home_url = program["websiteUrl"]
    seeds = [home_url, program["applyUrl"]]
    origin = f"{urlparse(home_url).scheme}://{urlparse(home_url).netloc}"
    try:
        _, home = read(fetcher, home_url)
    except Exception as error:
        discovery["pages"].append(
            {"url": home_url, "page": "details", "anchor": "", "fetched": False, "blocked": blocked_reason(error), "origin": "official"}
        )
        if (CHECKS / f"{program['id']}.json").exists():
            return None, discovery
        return _empty_checks(program, now, []), discovery
    findings.read(home_url, "details", home)
    pages_read = [home_url]
    quotes = [_quote(home_url, "details", home)]
    queue: list[tuple[int, int, str, str]] = []
    seen = {home_url.rstrip("/")}

    def push(url: str, kind: str, depth: int) -> None:
        cleaned = url.split("#")[0]
        key = cleaned.rstrip("/")
        if not key or key in seen or kind == "other" or depth > 2:
            return
        if urlparse(cleaned).scheme not in {"http", "https"} or not same_site(cleaned, seeds):
            return
        seen.add(key)
        queue.append((PRIORITY.get(kind, 9), depth, cleaned, kind))

    for href, kind, _anchor in linked_pages(program, home):
        push(href, kind, 1)
    for href, kind in _sitemap_candidates(fetcher, origin, seeds):
        push(href, kind, 1)
    apply_url = program["applyUrl"].split("#")[0]
    if apply_url.rstrip("/") != home_url.rstrip("/"):
        push(apply_url, classify(apply_url, "apply"), 1)
    status: dict[str, tuple[bool, str | None]] = {}
    while queue and len(pages_read) < MAX_PAGES:
        queue.sort()
        _priority, depth, href, kind = queue.pop(0)
        try:
            _, page = read(fetcher, href)
        except Exception as error:
            status[href] = (False, blocked_reason(error))
            continue
        status[href] = (True, _render_block(page))
        findings.read(href, kind, page)
        pages_read.append(href)
        quotes.append(_quote(href, kind, page))
        if depth < 2 and len(pages_read) < MAX_PAGES:
            for child, child_kind, _anchor in linked_pages(program, page):
                push(child, child_kind, depth + 1)
    recorded: set[str] = set()
    for href, kind, anchor in linked_pages(program, home):
        fetched, blocked = status.get(href, (False, None))
        discovery["pages"].append({"url": href, "page": kind, "anchor": anchor, "fetched": fetched, "blocked": blocked, "origin": "official"})
        recorded.add(href)
    for href, (fetched, blocked) in status.items():
        if href in recorded:
            continue
        discovery["pages"].append(
            {"url": href, "page": classify(href, ""), "anchor": "", "fetched": fetched, "blocked": blocked, "origin": "official"}
        )
    discovery["pages"].sort(key=lambda item: (item["url"], item["page"]))
    checks = {
        "programId": program["id"],
        "checkedAt": iso(now),
        "pagesRead": pages_read,
        "evidence": sorted(findings.evidence.values(), key=lambda item: item["id"]),
        "pageQuotes": quotes,
        "findings": findings.found,
    }
    return checks, discovery


def _render_block(page: Page) -> str | None:
    if page.render_gap == "playwright_missing":
        return "playwright_missing"
    return None


def _quote(url: str, kind: str, page: Page) -> dict:
    text = clip(page.visible()) or "Checked official page."
    return {
        "id": evidence_id("page", url),
        "url": url,
        "page": kind if kind in {"details", "terms", "portfolio", "batches", "application", "other"} else "details",
        "excerpt": text,
    }


def save(program_id: str, checks: dict | None, discovery: dict) -> list[Path]:
    """Write changed check and discovery files. A failed read keeps the earlier ones."""
    if checks is None:
        return []
    target = DISCOVERIES / f"{program_id}.json"
    if target.exists():
        discovery["pages"].extend(
            page for page in json.loads(target.read_text()).get("pages", []) if page.get("origin") == "secondary"
        )
    written = []
    if write_if_changed(target, discovery):
        written.append(target)
    path = CHECKS / f"{program_id}.json"
    if write_if_changed(path, checks):
        written.append(path)
    return written
