"""Rebuild taxonomy.json from the controlled vocabulary and the stored quotes."""

from __future__ import annotations

import json
import re
from datetime import datetime

from . import CHECKS, PROGRAMS, TAXONOMY, VOCABULARY, iso
from .records import dump
from .text import collapse

DEFAULT_NOTE = "A tag is present only where the named source quote supports it. Aliases are labels for the same tag, not extra claims. No tag is a company-fit score."


UNSPACED_SCRIPTS = re.compile(r"[\u1100-\u11ff\u3040-\u30ff\u3130-\u318f\u4e00-\u9fff\uac00-\ud7af]")


def alias_pattern(alias: str, case_sensitive: bool) -> re.Pattern[str]:
    """A whole-word match; a hyphen may follow ('AI-powered') but not precede ('pre-seed' is not 'seed').
    Korean, Japanese, and Chinese attach particles to words, so those aliases match as written."""
    flags = 0 if case_sensitive else re.I
    if UNSPACED_SCRIPTS.search(alias):
        return re.compile(re.escape(alias), flags)
    return re.compile(rf"(?<![\w-]){re.escape(alias)}(?!\w)", flags)


def supported(quote: str, needles: list[str]) -> bool:
    """The importer's own test: a label or alias appears in the quote."""
    haystack = collapse(quote).lower()
    return any(collapse(needle).lower() in haystack for needle in needles)


def derive_tags(now: datetime) -> tuple[int, int]:
    """Vocabulary tags attach where an alias is a whole word of a stored quote; curated tags are
    kept while their quote still supports them. Returns (tags, tagged Programs)."""
    vocabulary = json.loads(VOCABULARY.read_text())["tags"]
    taxonomy = json.loads(TAXONOMY.read_text())
    sources = {
        (program["id"], source["id"]): source["quote"]
        for program in (json.loads(path.read_text()) for path in sorted(PROGRAMS.glob("*.json")))
        for source in program["sources"]
        if not source["quote"].startswith(("http://", "https://"))
    }
    for path in sorted(CHECKS.glob("*.json")):
        checks = json.loads(path.read_text())
        program_id = checks.get("programId") or path.stem
        for item in checks.get("pageQuotes", []):
            if item.get("id") and item.get("excerpt"):
                sources[(program_id, item["id"])] = item["excerpt"]
    managed = {entry["id"] for entry in vocabulary}
    tags: list[dict] = []
    for tag in taxonomy["tags"]:
        if tag["id"] in managed:
            continue
        needles = [tag["label"], *tag["aliases"]]
        tag["evidence"] = [item for item in tag["evidence"] if supported(sources.get((item["programId"], item["sourceId"]), ""), needles)]
        if not tag["evidence"]:
            print(f"curated-tag-dropped\t{tag['id']}\tthe stored quotes no longer contain its wording")
            continue
        tags.append(tag)
    earlier = {tag["id"]: tag for tag in taxonomy["tags"] if tag["id"] in managed}
    for entry in vocabulary:
        sensitive = set(entry.get("caseSensitive", []))
        patterns = [alias_pattern(alias, alias in sensitive) for alias in entry["aliases"]]
        evidence = [
            {"programId": program_id, "sourceId": source_id}
            for (program_id, source_id), quote in sources.items()
            if any(pattern.search(quote) for pattern in patterns)
        ]
        needles = [entry["label"], *entry["aliases"]]
        for item in earlier.get(entry["id"], {}).get("evidence", []):
            if item not in evidence and supported(sources.get((item["programId"], item["sourceId"]), ""), needles):
                evidence.append(item)
        if evidence:
            tags.append(
                {
                    "id": entry["id"],
                    "facet": entry["facet"],
                    "label": entry["label"],
                    "aliases": entry["aliases"],
                    "evidence": sorted(evidence, key=lambda item: (item["programId"], item["sourceId"])),
                }
            )
    record = {"schemaVersion": 1, "checkedAt": taxonomy["checkedAt"], "note": taxonomy.get("note") or DEFAULT_NOTE, "tags": tags}
    if {**record, "checkedAt": None} != {**taxonomy, "checkedAt": None}:
        record["checkedAt"] = iso(now)
        TAXONOMY.write_text(dump(record))
    return len(tags), len({item["programId"] for tag in tags for item in tag["evidence"]})
