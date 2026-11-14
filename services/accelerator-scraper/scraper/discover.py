"""Find US accelerators, incubators, and university and state startup programs from public
lists, keep them in an operator review file, and add the ones the operator confirms.

There is no official register. Each source in discovery-sources.json names a public list
that robots.txt allows and that may be reused, and a parser for its layout. The lists
mostly give names and states; directory pages also link websites. Nothing reaches
programs/ until an operator has confirmed the official website.
"""

from __future__ import annotations

import html
import json
import re
import shutil
import subprocess
import tempfile
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable
from urllib.parse import urlparse

from . import CANDIDATES, DISCOVERY_SOURCES, PROGRAMS, iso
from .enrichment import enrich, linked_pages, save
from .facts import base_domain
from .net import Fetcher
from .outcome import Outcome
from .parse import Page
from .quotes import commit, read, refresh_homepage
from .records import skeleton
from .tags import derive_tags
from .text import window

SOURCE_BYTES = 60_000_000
STATUSES = ("new", "review", "confirmed", "rejected", "held", "added", "in_catalogue")
KINDS = ("accelerator", "incubator", "university program", "state or public program", "support organisation", "unknown")
STATES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
    "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC",
    "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL",
    "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA",
    "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
    "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
    "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR",
    "Pennsylvania": "PA", "Puerto Rico": "PR", "Rhode Island": "RI", "South Carolina": "SC",
    "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT",
    "Virginia": "VA", "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
    "Guam": "GU", "U.S. Virgin Islands": "VI",
}
AP_STATES = {
    "Ala.": "AL", "Alaska": "AK", "Ariz.": "AZ", "Ark.": "AR", "Calif.": "CA", "Colo.": "CO",
    "Conn.": "CT", "Del.": "DE", "D.C.": "DC", "Fla.": "FL", "Ga.": "GA", "Hawaii": "HI",
    "Idaho": "ID", "Ill.": "IL", "Ind.": "IN", "Iowa": "IA", "Kan.": "KS", "Kans.": "KS",
    "Ky.": "KY", "La.": "LA", "Maine": "ME", "Md.": "MD", "Mass.": "MA", "Mich.": "MI",
    "Minn.": "MN", "Miss.": "MS", "Mo.": "MO", "Mont.": "MT", "Neb.": "NE", "Nebr.": "NE",
    "Nev.": "NV", "N.H.": "NH", "N.J.": "NJ", "N.M.": "NM", "N.Y.": "NY", "N.C.": "NC",
    "N.D.": "ND", "Ohio": "OH", "Okla.": "OK", "Ore.": "OR", "Oreg.": "OR", "Pa.": "PA",
    "P.R.": "PR", "R.I.": "RI", "S.C.": "SC", "S.D.": "SD", "Tenn.": "TN", "Tex.": "TX",
    "Texas": "TX", "Utah": "UT", "Vt.": "VT", "Va.": "VA", "Wash.": "WA", "W. Va.": "WV",
    "Wis.": "WI", "Wyo.": "WY",
}
LEGAL_SUFFIXES = re.compile(
    r"\b(?:inc|incorporated|llc|l\.l\.c|corp|corporation|ltd|pbc|the|management|and partners|& partners)\b\.?",
    re.I,
)
SOCIAL_HOSTS = (
    "facebook.com", "twitter.com", "x.com", "linkedin.com", "instagram.com", "youtube.com", "youtu.be",
    "vimeo.com", "tiktok.com", "flickr.com", "pinterest.com", "maps.google.", "goo.gl", "bit.ly",
)
GENERIC_ANCHOR = re.compile(
    r"^(?:learn more|learn how to get involved|read more|more info(?:rmation)?|visit(?: (?:the|our|their))?(?: web ?site| site)?|"
    r"web ?site|click here|here|details|apply|apply now|go|link|more|view|see more)\W*$",
    re.I,
)
STARTUP_WORDS = re.compile(
    r"\bstart-?ups?\b|\bentrepreneur\w*|\bfounders?\b|\bincubat\w*|\baccelerat\w*|"
    r"\bventure (?:studio|program|lab)s?\b|\binnovation (?:hub|center|centre|program)s?\b",
    re.I,
)


@dataclass
class Sighting:
    name: str
    state: str | None
    source: str
    url: str
    city: str | None = None
    year: int | None = None
    website: str | None = None


@dataclass
class Source:
    id: str
    url: str
    origin: str
    parser: str
    state: str | None = None
    year: int | None = None
    options: dict = field(default_factory=dict)


def text_of(fragment: str) -> str:
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", fragment)).split())


def key_for(name: str) -> str:
    stripped = LEGAL_SUFFIXES.sub(" ", name.lower().replace("’", "'"))
    return re.sub(r"[^a-z0-9]+", "-", stripped).strip("-")


def aliases_for(name: str) -> list[str]:
    """'Rocky Mountain Innovation Initiative dba Innosphere' is also 'Innosphere'."""
    parts = re.split(r"\s+(?:dba|d/b/a|t/a|aka|a\.k\.a\.)\s+|\s*/\s*|\s*\(([^)]+)\)", name, flags=re.I)
    return [part.strip(" ,") for part in parts if part and part.strip(" ,") and part.strip(" ,") != name]


def website_of(value: str | None) -> str | None:
    if not value:
        return None
    # Directory PDFs carry line breaks and other control characters inside URLs.
    value = re.sub(r"[\x00-\x20\x7f]+", "", value).rstrip(".,;")
    if not re.match(r"^https?://", value, re.I):
        value = "https://" + value.lstrip("/")
    parsed = urlparse(value)
    return value if parsed.netloc and "." in parsed.netloc else None


def kind_for(name: str, website: str | None = None) -> str:
    """A guess for the reviewer, from the name and website; the operator has the last word."""
    host = urlparse(website or "").netloc.lower()
    if re.search(r"accelerat|bootcamp|fellowship|launchpad|xlr8|techstars|gener8tor", name, re.I):
        return "accelerator"
    if re.search(r"incubat|venture studio|innovation (?:center|centre|depot|hub)|\blabs?\b|biospace|foundry", name, re.I):
        return "incubator"
    if re.search(r"universit|college|school|i-corps|\bsuny\b|\bcuny\b", name, re.I) or host.endswith(".edu"):
        return "university program"
    if re.search(r"\bstate\b|department|commission|authority|county|city of|economic development", name, re.I) or host.endswith(".gov"):
        return "state or public program"
    if re.search(r"consult|council|association|foundation|institute|network|alliance|trust|chamber|sbdc", name, re.I):
        return "support organisation"
    return "unknown"


# Parsers. Each turns one source document into sightings.


def loc_gafc_appendix(body: str, source: Source) -> list[Sighting]:
    """Library of Congress GAFC evaluation, Appendix IV: 'City: Name (2015, 2016); Name (2014)'."""
    start = body.rfind("APPENDIX IV.")
    if start < 0:
        raise ValueError("Appendix IV was not found; the report layout changed")
    end = body.find("APPENDIX V", start + 10)
    sightings: list[Sighting] = []
    state: str | None = None
    city: str | None = None
    buffer = ""

    def flush() -> None:
        nonlocal buffer
        for entry in re.finditer(r"\s*(.+?)\s*\(((?:20\d\d)(?:,\s*20\d\d)*)\);?", buffer):
            for year in re.findall(r"20\d\d", entry.group(2)):
                sightings.append(Sighting(entry.group(1).strip(" ;"), state, source.id, source.url, city, int(year)))
        buffer = ""

    for raw in body[start : end if end > 0 else len(body)].splitlines()[1:]:
        line = raw.strip()
        if not line or re.fullmatch(r"\d+", line) or "Federal Research Division" in line or "Library of Congress" in line:
            continue
        if line in STATES:
            flush()
            state, city = STATES[line], None
            continue
        match = re.match(r"^([A-Z][A-Za-z .'’-]+?):\s+(.*)$", line)
        if match and state:
            flush()
            city, buffer = match.group(1), match.group(2)
        else:
            buffer += " " + line
    flush()
    return sightings


def sbir_gafc_table(body: str, source: Source) -> list[Sighting]:
    """SBIR.gov winner table: Track | State | Awardee."""
    sightings = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", body, re.S | re.I):
        cells = [text_of(cell) for cell in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S | re.I)]
        if len(cells) < 3 or cells[0] not in {"GAFC", "SBIR Catalyst"}:
            continue
        state = cells[1].split()[0] if re.match(r"^[A-Z]{2}\b", cells[1]) else None
        name = re.sub(r"\s+and partners$", "", cells[2], flags=re.I)
        sightings.append(Sighting(name, state, source.id, source.url, year=source.year))
    return sightings


def ap_state_list(body: str, source: Source) -> list[Sighting]:
    """List items written 'W. Va., ADL Ventures LLC' in AP state style."""
    sightings = []
    for item in re.findall(r"<li[^>]*>(.*?)</li>", body, re.S | re.I):
        value = text_of(item)
        for abbreviation, state in sorted(AP_STATES.items(), key=lambda pair: -len(pair[0])):
            if value.startswith(abbreviation + ", "):
                sightings.append(Sighting(value[len(abbreviation) + 2 :].strip(), state, source.id, source.url, year=source.year))
                break
    return sightings


def directory_links(body: str, source: Source) -> list[Sighting]:
    """A directory page: each entry is an outside link named by its title, its text, or the
    bold text or heading before it. options: start/end markers, exclude, namePrefix, nameFrom."""
    options = source.options
    begin = body.find(options["start"]) if options.get("start") else 0
    if begin < 0:
        raise ValueError(f"start marker {options['start']!r} was not found; the page layout changed")
    finish = body.find(options["end"], begin) if options.get("end") else -1
    page = Page.read(source.url, body[begin : finish if finish > 0 else len(body)])
    home = base_domain(urlparse(source.url).netloc)
    excluded = tuple(options.get("exclude", [])) + SOCIAL_HOSTS
    order = options.get("nameFrom", ["title", "text", "bold", "heading"])
    sightings: dict[str, Sighting] = {}
    for anchor in page.anchors:
        parsed = urlparse(anchor.href)
        if parsed.scheme not in {"http", "https"} or base_domain(parsed.netloc) == home:
            continue
        if any(token in anchor.href.lower() for token in excluded) or parsed.path.lower().endswith(".pdf"):
            continue
        labels = (re.sub(r"\s+link$", "", getattr(anchor, part), flags=re.I) for part in order)
        name = next((value for value in labels if meaningful(value)), None)
        if not name:
            continue
        name = options.get("namePrefix", "") + name
        sightings.setdefault(site_key(anchor.href), Sighting(name, source.state, source.id, source.url, year=source.year, website=anchor.href))
    return list(sightings.values())


def meaningful(value: str) -> bool:
    value = value.strip()
    return (
        2 <= len(value) <= 120
        and not GENERIC_ANCHOR.match(value)
        and not re.match(r"^(?:https?://|www\.)", value, re.I)
        and not re.search(r"\.(?:com|org|net|edu|gov|io)\b", value, re.I)
    )


def texas_incubator_directory(body: str, source: Source) -> list[Sighting]:
    """Texas Governor's directory: the name line, then 'Location:', 'Founded:', 'Website:'."""
    lines = [line.strip() for line in body.splitlines()]
    sightings = []
    for index, line in enumerate(lines):
        if not line.startswith("Location:"):
            continue
        previous = next((lines[back] for back in range(index - 1, max(index - 4, -1), -1) if lines[back]), "")
        if not previous or previous.isupper() or re.fullmatch(r"\d+", previous) or previous.endswith("Profiles"):
            continue
        website = next((lines[ahead][8:].strip() for ahead in range(index + 1, min(index + 5, len(lines))) if lines[ahead].startswith("Website:")), None)
        sightings.append(
            Sighting(previous, source.state, source.id, source.url, city=line[9:].strip() or None, year=source.year, website=website_of(website))
        )
    return sightings


def labelled_columns(body: str, source: Source) -> list[Sighting]:
    """A two-column PDF of labelled entries (Oklahoma's certified incubators): a city line,
    the name, then 'Address:' ... 'Website:'. The column split is where the second cell of a
    line most often starts."""
    lines = body.splitlines()
    second_cells = [
        cells[1].start()
        for cells in (list(re.finditer(r"\S(?:.*?\S)?(?=\s{3,}|$)", line)) for line in lines)
        if len(cells) >= 2
    ]
    split = Counter(second_cells).most_common(1)[0][0] - 1 if second_cells else 10_000
    columns: list[list[str]] = [[], []]
    for line in lines:
        cells = {0: "", 1: ""}
        for match in re.finditer(r"\S(?:.*?\S)?(?=\s{3,}|$)", line):
            cells[0 if match.start() < split else 1] += (" " if cells[0 if match.start() < split else 1] else "") + match.group(0)
        for column in (0, 1):
            columns[column].append(cells[column].strip())
    artifacts = re.compile(r"^(?:\d+|Directory|OkBIA Member Reciprocity Agreement|For-profit Incubator)$")
    sightings = []
    for column in columns:
        recent: list[str] = []
        pending: tuple[str, str | None] | None = None
        website: list[str] | None = None

        def emit(value: str) -> None:
            nonlocal pending, recent, website
            assert pending is not None
            sightings.append(Sighting(pending[0], source.state, source.id, source.url, city=pending[1], year=source.year, website=website_of(value)))
            pending, recent, website = None, [], None

        for line in column:
            if not line or artifacts.match(line):
                continue
            if website is not None:
                website.append(line)
                if not line.endswith(("-", "/")):
                    emit("".join(website))
            elif line.startswith("Address:"):
                name_lines = recent[-3:]
                city = name_lines[0] if len(name_lines) > 1 and len(name_lines[0].split()) <= 3 and "&" not in name_lines[0] else None
                name = " ".join(name_lines[1:] if city else name_lines[-2:])
                pending = (strip_footnotes(name), city)
                recent = []
            elif line.startswith("Website:") and pending:
                value = line[8:].strip()
                if not value or value.endswith(("-", "/")):
                    website = [value]
                else:
                    emit(value)
            elif pending is None:
                recent.append(line)
    unique: dict[str, Sighting] = {}
    for sighting in sightings:
        if sighting.name:
            unique.setdefault(key_for(sighting.name), sighting)
    return list(unique.values())


def strip_footnotes(name: str) -> str:
    """Oklahoma marks names with superscript 1 (OkBIA member) and 2 (for-profit), which pdftotext
    appends: 'Project 3810' + '12' reads 'Project 381012', 'Startup 405' + '1' reads 'Startup 4051'."""
    name = name.strip()
    for marker in ("12", "1", "2"):
        if name.endswith(marker) and len(name) > len(marker):
            return name[: -len(marker)].strip()
    return name


PARSERS: dict[str, tuple[Callable[[str, Source], list[Sighting]], str | None]] = {
    "loc-gafc-appendix": (loc_gafc_appendix, "layout"),
    "sbir-gafc-table": (sbir_gafc_table, None),
    "ap-state-list": (ap_state_list, None),
    "directory-links": (directory_links, None),
    "texas-incubator-directory": (texas_incubator_directory, "plain"),
    "labelled-columns": (labelled_columns, "layout"),
}


def load_sources() -> list[Source]:
    sources = []
    for entry in json.loads(DISCOVERY_SOURCES.read_text())["sources"]:
        if entry["parser"] not in PARSERS:
            raise SystemExit(f"{entry['id']}: unknown parser {entry['parser']} (known: {', '.join(PARSERS)})")
        sources.append(Source(entry["id"], entry["url"], entry["origin"], entry["parser"], entry.get("state"), entry.get("year"), entry.get("options", {})))
    return sources


def fetch_source(source: Source, fetcher: Fetcher) -> str:
    response = fetcher.fetch(source.url, max_bytes=SOURCE_BYTES)
    mode = PARSERS[source.parser][1]
    if mode is None:
        return response.text()
    if not shutil.which("pdftotext"):
        raise RuntimeError("PDF sources need pdftotext (poppler-utils) on PATH")
    with tempfile.NamedTemporaryFile(suffix=".pdf") as pdf:
        pdf.write(response.body)
        pdf.flush()
        flags = ["-layout"] if mode == "layout" else []
        return subprocess.run(["pdftotext", *flags, pdf.name, "-"], capture_output=True, check=True, timeout=180).stdout.decode()


# The review file.


def catalogue_index() -> tuple[dict[str, str], dict[str, str]]:
    by_name: dict[str, str] = {}
    by_site: dict[str, str] = {}
    for path in sorted(PROGRAMS.glob("*.json")):
        program = json.loads(path.read_text())
        by_name[key_for(program["name"])] = program["id"]
        by_name[program["id"]] = program["id"]
        by_site[site_key(program["websiteUrl"])] = program["id"]
    return by_name, by_site


def site_key(url: str | None) -> str:
    parsed = urlparse(url or "")
    return f"{parsed.netloc.lower().removeprefix('www.')}{parsed.path.rstrip('/').lower()}"


def new_entry(key: str, sighting: Sighting, now: datetime) -> dict:
    return {
        "key": key,
        "name": sighting.name,
        "aliases": aliases_for(sighting.name),
        "kind": kind_for(sighting.name, sighting.website),
        "state": sighting.state,
        "cities": [],
        "years": [],
        "sources": [],
        "status": "new",
        "website": None,
        "applyUrl": None,
        "programId": None,
        "note": None,
        "firstSeenAt": iso(now),
    }


def merge(sightings: list[Sighting], existing: dict[str, dict], now: datetime) -> dict[str, dict]:
    """Fold sightings into the review entries without touching an operator's decisions."""
    by_name, by_site = catalogue_index()
    entries = dict(existing)
    alias_keys = {key_for(alias): entry["key"] for entry in entries.values() for alias in entry.get("aliases", [])}
    for sighting in sightings:
        key = key_for(sighting.name)
        if not key:
            continue
        known = [candidate for candidate in [key, *map(key_for, aliases_for(sighting.name))] if candidate in entries or candidate in alias_keys]
        if known:
            key = known[0] if known[0] in entries else alias_keys[known[0]]
        entry = entries.get(key)
        if entry is None:
            entry = entries[key] = new_entry(key, sighting, now)
            for alias in entry["aliases"]:
                alias_keys[key_for(alias)] = key
        entry.setdefault("kind", kind_for(entry["name"], sighting.website))
        entry.pop("hint", None)
        if sighting.state and not entry["state"]:
            entry["state"] = sighting.state
        if sighting.city and sighting.city not in entry["cities"]:
            entry["cities"].append(sighting.city)
        if sighting.year and sighting.year not in entry["years"]:
            entry["years"] = sorted([*entry["years"], sighting.year])
        listed = next((item for item in entry["sources"] if item["id"] == sighting.source), None)
        if listed is None:
            listed = {"id": sighting.source, "url": sighting.url}
            entry["sources"].append(listed)
        if sighting.website:
            listed["website"] = sighting.website
            if not entry["website"] and entry["status"] == "new":
                entry["website"], entry["status"] = sighting.website, "review"
    for entry in entries.values():
        matched = next((by_name[name] for name in [entry["key"], *map(key_for, entry["aliases"])] if name in by_name), None)
        matched = matched or by_site.get(site_key(entry["website"]))
        if matched and entry["status"] in {"new", "review"}:
            entry["status"], entry["programId"] = "in_catalogue", matched
    return dict(sorted(entries.items()))


def load() -> dict[str, dict]:
    if not CANDIDATES.exists():
        return {}
    data = json.loads(CANDIDATES.read_text())
    for entry in data["candidates"]:
        if entry["status"] not in STATUSES:
            raise SystemExit(f"{entry['key']}: status must be one of {', '.join(STATUSES)}")
    return {entry["key"]: entry for entry in data["candidates"]}


def save_candidates(entries: dict[str, dict], now: datetime, sources: list[dict], harvested_at: str | None = None) -> None:
    CANDIDATES.write_text(
        json.dumps(
            {
                "note": (
                    "Operator review file. For each entry you keep, set website to the official site and status to "
                    "confirmed; otherwise set status to rejected with a note. Entries in review already carry the "
                    "website a source listed; check it before confirming. A harvest never overwrites status, website, "
                    "applyUrl, kind, or note. discover vet records a reason on every new or review entry."
                ),
                "harvestedAt": harvested_at or iso(now),
                "sources": sources,
                "candidates": list(entries.values()),
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n"
    )


def summary(entries: dict[str, dict]) -> str:
    statuses: dict[str, int] = {}
    kinds: dict[str, int] = {}
    for entry in entries.values():
        statuses[entry["status"]] = statuses.get(entry["status"], 0) + 1
        kinds[entry.get("kind", "unknown")] = kinds.get(entry.get("kind", "unknown"), 0) + 1
    return (
        f"{len(entries)} organisations: "
        + ", ".join(f"{statuses.get(status, 0)} {status}" for status in STATUSES)
        + "\nby kind (a guess for the reviewer): "
        + ", ".join(f"{kinds.get(kind, 0)} {kind}" for kind in KINDS)
    )


def harvest(now: datetime, fetcher: Fetcher | None = None) -> dict[str, dict]:
    fetcher = fetcher or Fetcher()
    sightings: list[Sighting] = []
    report: list[dict] = []
    for source in load_sources():
        try:
            found = PARSERS[source.parser][0](fetch_source(source, fetcher), source)
            if not found:
                raise ValueError("no names were parsed; the source layout may have changed")
        except Exception as error:
            print(f"source-failed\t{source.id}\t{error}")
            report.append({"id": source.id, "url": source.url, "origin": source.origin, "names": 0, "error": str(error)})
            continue
        print(f"source\t{source.id}\t{len(found)} names")
        report.append({"id": source.id, "url": source.url, "origin": source.origin, "names": len(found), "checkedAt": iso(now)})
        sightings.extend(found)
    entries = merge(sightings, load(), now)
    save_candidates(entries, now, report)
    print(summary(entries))
    return entries


def startup_evidence(fetcher: Fetcher, url: str) -> str | None:
    """The excerpt showing the official site serves startups or founders, or None."""
    _, home = read(fetcher, url)
    pages = [home]
    for href, kind, _ in linked_pages({"websiteUrl": url, "applyUrl": url}, home):
        if kind in {"details", "application", "batches"} and len(pages) < 3:
            try:
                pages.append(read(fetcher, href)[1])
            except Exception:
                continue
    for page in pages:
        visible = page.visible()
        match = STARTUP_WORDS.search(visible)
        if match:
            return window(visible, match.start(), match.end(), 80)
    return None


def program_id_for(entry: dict, taken: set[str]) -> str:
    base = entry["key"][:60].strip("-")
    candidate, suffix = base, 2
    while candidate in taken:
        candidate, suffix = f"{base[:57]}-{suffix}", suffix + 1
    return candidate


def add_confirmed(now: datetime, fetcher: Fetcher | None = None) -> list[str]:
    """Scrape each confirmed entry into a homepage record. The official pages must speak to
    startups or founders, and the usual text and logo checks must pass; otherwise 'held'."""
    fetcher = fetcher or Fetcher()
    entries = load()
    taken = {path.stem for path in PROGRAMS.glob("*.json")}
    added: list[str] = []
    for entry in entries.values():
        if entry["status"] != "confirmed":
            continue
        website = website_of(entry.get("website"))

        def hold(reason: str) -> None:
            entry["status"], entry["note"] = "held", reason
            print(f"held\t{entry['key']}\t{reason}")

        if not website:
            hold("Confirmed without a usable website.")
            continue
        try:
            excerpt = startup_evidence(fetcher, website)
        except Exception as error:
            hold(f"The official site could not be read: {error}")
            continue
        if excerpt is None:
            hold("The official pages do not mention startups, founders, entrepreneurs, incubation, or acceleration.")
            continue
        program_id = program_id_for(entry, taken)
        program = skeleton(program_id, entry["name"], website, website_of(entry.get("applyUrl")) or website, now)
        outcome = Outcome(program_id, program, PROGRAMS / f"{program_id}.json")
        refresh_homepage(fetcher, outcome, now, stamp=True)
        homepage = next(source for source in program["sources"] if source["id"] == "homepage")
        if not homepage["quote"] or outcome.logo is None:
            hold("The page text or an official logo could not be collected: " + "; ".join(outcome.lines[-2:]))
            continue
        commit([outcome])
        checks, discovery = enrich(program, fetcher, now)
        save(program_id, checks, discovery)
        taken.add(program_id)
        added.append(program_id)
        entry["status"], entry["programId"] = "added", program_id
        reason = (entry.get("vetting") or {}).get("reason")
        entry["note"] = f"{reason} Startup wording on the official site: {excerpt}" if reason else f"Startup wording on the official site: {excerpt}"
        print(f"added\t{program_id}\t{website}")
    if added:
        derive_tags(now)
    save_candidates(entries, now, json.loads(CANDIDATES.read_text()).get("sources", []) if CANDIDATES.exists() else [])
    print(f"added {len(added)} programs\n{summary(entries)}")
    return added


ACCELERATOR_SIGNALS = (
    ("accelerator", re.compile(r"\baccelerators?\b(?! (?:pedal|card))", re.I)),
    ("cohort", re.compile(r"\b(?:cohorts?|batches?)\b", re.I)),
    # Investment wording only. "safe" and "equity" alone are ordinary words ("a safe space",
    # "equity and inclusion"); SAFE counts only in capitals, equity only next to a stake or a percentage.
    (
        "investment",
        re.compile(
            r"\b(?:we invest|invests? (?:up to )?\$|investment of|pre-seed investment|seed investment|"
            r"convertible note|equity (?:stake|investment)|in exchange for (?:\d+(?:\.\d+)?\s?%|equity)|"
            r"\d+(?:\.\d+)?\s?% (?:equity|of (?:the )?(?:company|equity)))\b",
            re.I,
        ),
    ),
    ("investment", re.compile(r"\bSAFEs?\b")),
    ("demo-day", re.compile(r"\bdemo days?\b", re.I)),
    ("application", re.compile(r"\b(?:apply|application|applications)\b", re.I)),
    ("startup-program", re.compile(r"\b(?:startup program|accelerator program|for founders|for startups|early-stage startups)\b", re.I)),
)
COWORKING = re.compile(r"\bco-?working\b", re.I)
INCUBATOR = re.compile(r"\bincubat\w*\b", re.I)
COURSE = re.compile(r"\b(?:syllabus|course credits?|undergraduate course|enroll in (?:the|this) course)\b", re.I)
DEFUNCT = re.compile(r"\b(?:domain (?:is )?for sale|this domain has expired|buy this domain|parkingcrew|hugedomains)\b", re.I)
# Customer-discovery training and member organisations run cohorts without being accelerators.
NOT_AN_ACCELERATOR = re.compile(r"\b(?:I-Corps|chamber of commerce|customer discovery training)\b", re.I)


def vet_text(text: str) -> tuple[str, str, list[str]]:
    """Return (accept|reject, reason, signals) from visible page text. No network.

    An accelerator names itself as one (or runs a demo day), runs a cohort or invests on stated
    terms, and takes applications. Anything less is rejected with the signals that were found.
    """
    signals = list(dict.fromkeys(name for name, pattern in ACCELERATOR_SIGNALS if pattern.search(text)))
    found = ", ".join(signals) if signals else "none"
    if DEFUNCT.search(text):
        return "reject", "Defunct or parked domain.", signals
    if NOT_AN_ACCELERATOR.search(text):
        return "reject", f"Training program or member organisation, not an accelerator (found: {found}).", signals
    if COURSE.search(text) and "investment" not in signals and "cohort" not in signals:
        return "reject", "University course, not an accelerator program.", signals
    identity = {"accelerator", "demo-day"} & set(signals)
    structure = {"cohort", "investment"} & set(signals)
    if COWORKING.search(text) and not identity:
        return "reject", f"Coworking space that does not run an accelerator (found: {found}).", signals
    if INCUBATOR.search(text) and not identity:
        return "reject", f"Incubator that does not run an accelerator (found: {found}).", signals
    if identity and structure and "application" in signals:
        return "accept", f"Accelerator signals: {found}.", signals
    return "reject", f"Insufficient accelerator signals (found: {found}).", signals


# Errors that mean the site no longer exists, as opposed to a slow or failing server.
GONE = re.compile(r"nodename nor servname|Name or service not known|getaddrinfo failed|HTTP Error 40[14]|HTTP Error 410|\b(?:404|410)\b")


def vet(now: datetime, fetcher: Fetcher | None = None, workers: int = 8) -> dict[str, int]:
    """Rule-based accept/reject for status new, review and held. Every entry gets a reason.

    A site that is gone (no DNS name, HTTP 404/410) is rejected. A timeout, server error or
    unreadable robots.txt is held and tried again on the next vet, never rejected on one attempt.
    """
    from concurrent.futures import ThreadPoolExecutor

    fetcher = fetcher or Fetcher()
    raw = json.loads(CANDIDATES.read_text()) if CANDIDATES.exists() else {"sources": [], "harvestedAt": iso(now)}
    entries = load()
    pending = [entry for entry in entries.values() if entry["status"] in {"new", "review", "held"}]

    def decide(entry: dict) -> None:
        website = website_of(entry.get("website"))
        if not website:
            entry["vetting"] = {"decision": "reject", "reason": "No official website; accelerator signals could not be checked.", "signals": []}
            entry["status"] = "rejected"
            entry["note"] = entry["vetting"]["reason"]
            print(f"reject\t{entry['key']}\t{entry['note']}")
            return
        try:
            _html, page = read(fetcher, website)
        except Exception as error:
            gone = GONE.search(str(error)) is not None
            reason = f"{'Defunct domain' if gone else 'Unreachable, will retry'}: {error}"
            entry["vetting"] = {"decision": "reject" if gone else "held", "reason": reason, "signals": []}
            entry["status"] = "rejected" if gone else "held"
            entry["note"] = reason
            print(f"{'reject' if gone else 'held'}\t{entry['key']}\t{reason}")
            return
        decision, reason, signals = vet_text(page.visible())
        entry["vetting"] = {"decision": decision, "reason": reason, "signals": signals}
        entry["website"] = website
        if decision == "accept":
            entry["status"] = "confirmed"
            entry["note"] = reason
            print(f"accept\t{entry['key']}\t{reason}")
        else:
            entry["status"] = "rejected"
            entry["note"] = reason
            print(f"reject\t{entry['key']}\t{reason}")

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        list(pool.map(decide, pending))
    save_candidates(entries, now, raw.get("sources", []), harvested_at=raw.get("harvestedAt"))
    counts = {"accept": 0, "reject": 0}
    for entry in pending:
        counts[entry["vetting"]["decision"]] = counts.get(entry["vetting"]["decision"], 0) + 1
    print(
        f"vetted {len(pending)} candidates: {counts.get('accept', 0)} accepted, "
        f"{counts.get('reject', 0)} rejected, {counts.get('held', 0)} held for retry"
    )
    return counts
