"""Re-check every stored quote; rebuild homepage records whose page has moved on."""

from __future__ import annotations

import json
from datetime import datetime

from . import LOGO_REVIEW, OBSERVATIONS, PROGRAMS, iso
from .logos import refresh_logo
from .net import Fetcher, unreachable
from .outcome import Outcome
from .parse import Page
from .records import dump, is_homepage_record, load_program, narratives
from .text import bot_wall, clip, collapse, mostly_quoted, searchable, still_quoted


def read(fetcher: Fetcher, url: str) -> tuple[str, Page]:
    response = fetcher.fetch(url)
    html = response.text()
    return html, Page.read(response.url, html)


def refresh_homepage(fetcher: Fetcher, outcome: Outcome, now: datetime, stamp: bool) -> None:
    program = outcome.program
    source = next(item for item in program["sources"] if item["id"] == "homepage")
    try:
        html, page = read(fetcher, source["url"])
    except Exception as error:
        status, detail = unreachable(error)
        outcome.note(status, f"{source['url']}\t{error}")
        outcome.observe("homepage", "inaccessible", now, detail)
        return
    outcome.reached = True
    visible = page.visible()
    wall = bot_wall(visible)
    if wall:
        outcome.note("blocked", wall)
        outcome.observe("homepage", "inaccessible", now, wall + " The stored excerpt was kept.")
        return
    if mostly_quoted(source["quote"], searchable(visible, html)):
        outcome.note("current", source["url"])
        if stamp:
            source["checkedAt"] = iso(now)
            outcome.stamped = True
    else:
        quote = clip(visible)
        source["quote"] = quote
        source["checkedAt"] = iso(now)
        program["description"], program["targetApplicants"] = narratives(quote, now)
        outcome.changed = outcome.drift = True
        outcome.note("updated", f"{source['url']}\t{quote[:80]}")
    refresh_logo(fetcher, outcome, html, page, now, stamp)


def recheck_curated(fetcher: Fetcher, outcome: Outcome, now: datetime, stamp: bool) -> None:
    """Hand-collected records are only re-checked; a missing quote is reported, never rewritten."""
    pages: dict[str, str | Exception] = {}
    for source in outcome.program["sources"]:
        url = source["url"]
        if url not in pages:
            try:
                html, page = read(fetcher, url)
                pages[url] = searchable(page.visible(), html)
                outcome.reached = True
            except Exception as error:
                pages[url] = error
        haystack = pages[url]
        if isinstance(haystack, Exception):
            status, detail = unreachable(haystack)
            outcome.note(status, f"{source['id']}\t{haystack}")
            outcome.observe(source["id"], "inaccessible", now, detail)
        elif still_quoted(source["quote"], haystack):
            outcome.note("current", source["id"])
            if stamp:
                source["checkedAt"] = iso(now)
                outcome.stamped = True
        else:
            outcome.drift = True
            outcome.note("stale", f"{source['id']}\t{collapse(source['quote'])[:80]}")
            outcome.observe(source["id"], "stale", now, "The stored excerpt is no longer on the page. It was not replaced.")


def scrape_program(program_id: str, fetcher: Fetcher, now: datetime, stamp: bool) -> Outcome:
    program = load_program(program_id)
    outcome = Outcome(program_id, program, PROGRAMS / f"{program_id}.json")
    if is_homepage_record(program):
        refresh_homepage(fetcher, outcome, now, stamp)
    else:
        recheck_curated(fetcher, outcome, now, stamp)
    return outcome


def commit(outcomes: list[Outcome]) -> None:
    for outcome in outcomes:
        if outcome.logo:
            target, png = outcome.logo
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(png)
            if outcome.old_logo:
                outcome.old_logo.unlink()
        if outcome.changed or outcome.stamped:
            outcome.path.write_text(dump(outcome.program))


def merge_report(path, outcomes: list[Outcome], items: list[dict], header: dict) -> None:
    """Replace the scraped Programs' rows in a report and keep every other Program's."""
    scraped = {outcome.program_id for outcome in outcomes}
    kept: list[dict] = []
    if path.exists():
        kept = [item for item in json.loads(path.read_text()).get("items", []) if item["programId"] not in scraped]
    merged = sorted(kept + items, key=lambda item: (item["programId"], item.get("evidenceId", "")))
    if not merged and not path.exists():
        return
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps({**header, "items": merged}, indent=2, ensure_ascii=False) + "\n")


def record_observations(outcomes: list[Outcome], now: datetime) -> None:
    items = [item for outcome in outcomes for item in outcome.observations]
    merge_report(OBSERVATIONS, outcomes, items, {"checkedAt": iso(now)})


def record_logo_review(outcomes: list[Outcome], now: datetime) -> None:
    items = [
        {
            "programId": outcome.program_id,
            "storedUrl": outcome.suspect_logo,
            "checkedAt": iso(now),
            "detail": "The stored mark is a page image whose file name or alt text does not name the Program, so it may be a partner's or a portfolio company's logo. No header mark or site icon could replace it automatically.",
        }
        for outcome in outcomes
        if outcome.suspect_logo
    ]
    merge_report(LOGO_REVIEW, outcomes, items, {})
