#!/usr/bin/env python3
"""Discover official pages linked from a Program. Does not invent facts or ids.

  python3 fixtures/accelerators/collect.py --self-test
  python3 fixtures/accelerators/collect.py --discover a16z-speedrun
  python3 fixtures/accelerators/collect.py --all
  python3 fixtures/accelerators/collect.py --discover a16z-speedrun \\
      --secondary https://example.com/gap --gap portfolio

--self-test checks the page classifier locally and does not fetch those sample
URLs. --discover reads one Program file. --all reads every file in programs/.
A secondary URL is recorded only for a named gap. It is not copied into a claim.
"""

from __future__ import annotations

import argparse
import json
import ssl
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen
from urllib.robotparser import RobotFileParser

ROOT = Path(__file__).resolve().parent
PROGRAMS = ROOT / "programs"
DISCOVERIES = ROOT / "discoveries"
UA = "LaunchStackCatalogueRefresh/1.0"
ROBOTS: dict[str, RobotFileParser | None] = {}
RULES = (
    ("portfolio", ("portfolio", "companies", "alumni")),
    ("terms", ("/deal", "deal", "faq", "investment-terms")),
    ("batches", ("cohort", "batch", "deadline", "dates")),
    ("application", ("apply", "application")),
    ("details", ("about", "program", "overview")),
)


class Anchors(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        href = dict(attrs).get("href")
        if href:
            self._href = href
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._href is not None:
            self.links.append((self._href, " ".join(self._text).strip()))
            self._href = None


def classify(url: str, anchor: str) -> str:
    hay = f"{url} {anchor}".lower()
    if any(skip in hay for skip in ("terms of use", "terms-of-use", "privacy", "cookie")):
        return "other"
    for page, words in RULES:
        if any(word in hay for word in words):
            return page
    return "other"


def allowed(url: str) -> bool:
    parsed = urlparse(url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    if origin not in ROBOTS:
        parser = RobotFileParser()
        parser.set_url(origin + "/robots.txt")
        try:
            parser.read()
            ROBOTS[origin] = parser
        except Exception:
            ROBOTS[origin] = None
    parser = ROBOTS[origin]
    return True if parser is None else parser.can_fetch(UA, url)


def fetch(url: str) -> str:
    request = Request(url, headers={"User-Agent": UA})
    with urlopen(request, timeout=25, context=ssl.create_default_context()) as response:
        return response.read().decode("utf-8", "replace")


def same_site(url: str, seeds: list[str]) -> bool:
    host = urlparse(url).netloc.lower()
    return any(
        host == urlparse(seed).netloc.lower() or host.endswith("." + urlparse(seed).netloc.lower())
        for seed in seeds
    )


def self_test() -> None:
    samples = {
        "https://speedrun.a16z.com/companies": "portfolio",
        "https://speedrun.a16z.com/faq": "terms",
        "https://www.antler.co/cohort-start-dates": "batches",
        "https://www.eranyc.com/apply/": "application",
        "https://skydeck.berkeley.edu/program/": "details",
        "https://example.com/blog/hello": "other",
        "https://a16z.com/terms-of-use/": "other",
        "https://a16z.com/announcement/investing-in-phaze/": "other",
    }
    for url, expected in samples.items():
        found = classify(url, "")
        if found != expected:
            raise SystemExit(f"{url} classified as {found}, expected {expected}")
    print("self-test ok")


def program_ids() -> list[str]:
    ids: list[str] = []
    for path in sorted(PROGRAMS.glob("*.json")):
        program = json.loads(path.read_text())
        program_id = path.stem
        if program.get("id") != program_id:
            raise SystemExit(f"{path} id does not match the filename")
        ids.append(program_id)
    if not ids:
        raise SystemExit(f"No Program files in {PROGRAMS}")
    return ids


def discover(program_id: str, secondary: str | None, gap: str | None) -> None:
    path = PROGRAMS / f"{program_id}.json"
    program = json.loads(path.read_text())
    if program.get("id") != program_id:
        raise SystemExit(f"{path} id does not match the filename")
    if secondary and not gap:
        raise SystemExit("A secondary source has to name the gap it fills")
    seeds = [program["websiteUrl"], program["applyUrl"]]
    seeds.extend(source["url"] for source in program["sources"])
    pages: list[dict[str, object]] = []
    seen: set[str] = set()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for seed in seeds:
        if seed in seen or not same_site(seed, seeds):
            continue
        seen.add(seed)
        if not allowed(seed):
            pages.append(
                {
                    "url": seed,
                    "page": classify(seed, ""),
                    "anchor": "",
                    "fetched": False,
                    "blocked": "robots",
                    "origin": "official",
                }
            )
            continue
        try:
            html = fetch(seed)
        except Exception as error:
            print(f"fetch-failed\t{program_id}\t{seed}\t{error}")
            pages.append(
                {
                    "url": seed,
                    "page": classify(seed, ""),
                    "anchor": "",
                    "fetched": False,
                    "blocked": "fetch_failed",
                    "origin": "official",
                }
            )
            continue
        parser = Anchors()
        parser.feed(html)
        for href, anchor in parser.links:
            absolute = urljoin(seed, href)
            parsed = urlparse(absolute)
            if parsed.scheme not in {"http", "https"} or absolute in seen:
                continue
            if not same_site(absolute, seeds):
                continue
            page = classify(absolute, anchor)
            if page == "other":
                continue
            seen.add(absolute)
            blocked = None
            fetched_page = False
            if not allowed(absolute):
                blocked = "robots"
            elif len([item for item in pages if item["fetched"]]) < 12:
                try:
                    fetch(absolute)
                    fetched_page = True
                except Exception:
                    blocked = "fetch_failed"
            pages.append(
                {
                    "url": absolute,
                    "page": page,
                    "anchor": anchor[:180],
                    "fetched": fetched_page,
                    "blocked": blocked,
                    "origin": "official",
                }
            )
    if secondary:
        pages.append(
            {
                "url": secondary,
                "page": gap if gap in {"details", "terms", "portfolio", "batches", "application"} else "other",
                "anchor": gap or "",
                "fetched": False,
                "blocked": None,
                "origin": "secondary",
            }
        )
    DISCOVERIES.mkdir(exist_ok=True)
    destination = DISCOVERIES / f"{program_id}.json"
    destination.write_text(
        json.dumps(
            {"programId": program_id, "checkedAt": now, "pages": pages},
            indent=2,
            ensure_ascii=False,
        )
        + "\n"
    )
    print(f"wrote {destination} ({len(pages)} links)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--discover")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--secondary")
    parser.add_argument("--gap")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if args.all:
        if args.discover or args.secondary or args.gap:
            raise SystemExit("--all reads every Program file and does not take one id or a secondary URL")
        ids = program_ids()
        for program_id in ids:
            discover(program_id, None, None)
        print(f"discovered {len(ids)} programs")
        return
    if not args.discover:
        raise SystemExit("Use --self-test, --discover <program-id>, or --all")
    discover(args.discover, args.secondary, args.gap)


if __name__ == "__main__":
    main()
