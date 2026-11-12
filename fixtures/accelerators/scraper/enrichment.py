"""Read a Program's homepage and up to four linked official pages; record what they state."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from . import CHECKS, DISCOVERIES, iso
from .facts import Findings, classify, same_site
from .net import Fetcher
from .parse import Page
from .quotes import read
from .records import write_if_changed

EXTRA_PAGES = ("application", "terms", "batches", "details")


def linked_pages(program: dict, page: Page) -> list[tuple[str, str, str]]:
    """Same-site links classified by kind (details, terms, portfolio, batches, application)."""
    seeds = [program["websiteUrl"], program["applyUrl"]]
    pages: list[tuple[str, str, str]] = []
    seen = {program["websiteUrl"].rstrip("/")}
    for anchor in page.anchors:
        href = anchor.href
        if urlparse(href).scheme not in {"http", "https"} or not same_site(href, seeds):
            continue
        key = href.split("#")[0].rstrip("/")
        kind = classify(href, anchor.text)
        if key in seen or kind == "other":
            continue
        seen.add(key)
        pages.append((href.split("#")[0], kind, anchor.text[:180]))
    return pages


def blocked_reason(error: Exception) -> str:
    return "robots" if isinstance(error, PermissionError) else "fetch_failed"


def enrich(program: dict, fetcher: Fetcher, now: datetime) -> tuple[dict | None, dict]:
    """The checks record (None when the homepage could not be read) and the discovery record."""
    findings = Findings(program, now.date())
    discovery: dict = {"programId": program["id"], "checkedAt": iso(now), "pages": []}
    try:
        _, home = read(fetcher, program["websiteUrl"])
    except Exception as error:
        discovery["pages"].append(
            {"url": program["websiteUrl"], "page": "details", "anchor": "", "fetched": False, "blocked": blocked_reason(error), "origin": "official"}
        )
        return None, discovery
    findings.read(program["websiteUrl"], "details", home)
    links = linked_pages(program, home)
    chosen: dict[str, str] = {}
    for href, kind, _ in links:
        if kind in EXTRA_PAGES and kind not in chosen:
            chosen[kind] = href
    apply_url = program["applyUrl"]
    if "application" not in chosen and same_site(apply_url, [program["websiteUrl"]]) and apply_url.rstrip("/") != program["websiteUrl"].rstrip("/"):
        chosen["application"] = apply_url
    status: dict[str, tuple[bool, str | None]] = {}
    for kind, href in chosen.items():
        try:
            _, page = read(fetcher, href)
        except Exception as error:
            status[href] = (False, blocked_reason(error))
            continue
        status[href] = (True, None)
        findings.read(href, kind, page)
    for href, kind, anchor in links:
        fetched, blocked = status.get(href, (False, None))
        discovery["pages"].append({"url": href, "page": kind, "anchor": anchor, "fetched": fetched, "blocked": blocked, "origin": "official"})
    for kind, href in chosen.items():
        if not any(item["url"] == href for item in discovery["pages"]):
            fetched, blocked = status[href]
            discovery["pages"].append({"url": href, "page": kind, "anchor": "", "fetched": fetched, "blocked": blocked, "origin": "official"})
    checks = {
        "programId": program["id"],
        "checkedAt": iso(now),
        "pagesRead": [program["websiteUrl"], *(href for href, (fetched, _) in status.items() if fetched)],
        "evidence": sorted(findings.evidence.values(), key=lambda item: item["id"]),
        "findings": findings.found,
    }
    return checks, discovery


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
