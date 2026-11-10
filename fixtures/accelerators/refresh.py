#!/usr/bin/env python3
"""Re-check source quotes for existing Programs without creating identities.

Usage:
  python3 fixtures/accelerators/refresh.py --check y-combinator
  python3 fixtures/accelerators/refresh.py --write y-combinator

--check reports whether each stored quote is still on the official page.
--write updates checkedAt only when every quote segment is still present.
A quote that no longer matches is reported and left unchanged. Program ids,
cycle ids, and source ids are never replaced or duplicated.
"""

from __future__ import annotations

import argparse
import json
import re
import ssl
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

ROOT = Path(__file__).resolve().parent
PROGRAMS = ROOT / "programs"
OBSERVATIONS = ROOT / "intelligence" / "refresh-observations.json"
UA = "LaunchStackCatalogueRefresh/1.0"
ROBOTS: dict[str, RobotFileParser | None] = {}


class Text(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript", "svg"}:
            self.skip += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript", "svg"} and self.skip:
            self.skip -= 1

    def handle_data(self, data: str) -> None:
        if self.skip == 0 and data.strip():
            self.parts.append(data)


def collapse(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def loosen(value: str) -> str:
    """Ignore spaces an HTML link leaves before punctuation."""
    return re.sub(r"\s+([.,;:!?])", r"\1", value)


def segments(quote: str) -> list[str]:
    parts = re.split(r"\[\s*…\s*\]|\[\s*\.\.\.\s*\]|\n+", quote)
    return [collapse(part) for part in parts if collapse(part)]


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
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=25, context=ssl.create_default_context()) as response:
        raw = response.read().decode("utf-8", "replace")
    parser = Text()
    parser.feed(raw)
    visible = collapse(" ".join(parser.parts))
    raw_text = collapse(raw.replace("&quot;", '"').replace("&#39;", "'").replace("&amp;", "&"))
    return visible + "\n" + raw_text


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("ids", nargs="+")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--write", action="store_true")
    args = parser.parse_args()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    observations: list[dict[str, str]] = []
    for program_id in args.ids:
        path = PROGRAMS / f"{program_id}.json"
        program = json.loads(path.read_text())
        if program.get("id") != program_id:
            raise SystemExit(f"{path} id does not match the filename")
        changed = False
        for source in program["sources"]:
            url = source["url"]
            if not allowed(url):
                print(f"robots-skip\t{program_id}\t{source['id']}\t{url}")
                observations.append(
                    {
                        "programId": program_id,
                        "evidenceId": source["id"],
                        "outcome": "inaccessible",
                        "checkedAt": now,
                        "detail": "robots.txt disallows a refresh of this URL. The stored excerpt was kept.",
                    }
                )
                continue
            try:
                page = fetch(url)
            except Exception as error:
                print(f"fetch-failed\t{program_id}\t{source['id']}\t{error}")
                observations.append(
                    {
                        "programId": program_id,
                        "evidenceId": source["id"],
                        "outcome": "inaccessible",
                        "checkedAt": now,
                        "detail": "The page could not be fetched. The stored excerpt and last successful check were kept.",
                    }
                )
                continue
            loose_page = loosen(page)
            missing = [
                segment for segment in segments(source["quote"]) if loosen(segment) not in loose_page
            ]
            if missing:
                print(f"stale\t{program_id}\t{source['id']}\t{missing[0][:80]}")
                observations.append(
                    {
                        "programId": program_id,
                        "evidenceId": source["id"],
                        "outcome": "stale",
                        "checkedAt": now,
                        "detail": "The stored excerpt is no longer on the page. It was not replaced.",
                    }
                )
                continue
            print(f"current\t{program_id}\t{source['id']}")
            if args.write and source.get("checkedAt") != now:
                source["checkedAt"] = now
                changed = True
        if changed:
            path.write_text(json.dumps(program, indent=2, ensure_ascii=False) + "\n")
            print(f"wrote\t{path}")
    if observations:
        OBSERVATIONS.parent.mkdir(exist_ok=True)
        OBSERVATIONS.write_text(
            json.dumps({"checkedAt": now, "items": observations}, indent=2) + "\n"
        )
        print(f"wrote\t{OBSERVATIONS}")


if __name__ == "__main__":
    main()
