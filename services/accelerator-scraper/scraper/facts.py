"""The rules that turn page text into cited facts. Anything a rule does not match stays unstated.

Each finding keeps the excerpt it came from. Deliberately ignored: personal mailboxes,
addresses on other domains, past dates, dates without deadline wording, refund or fee
deadlines, percentages without acceptance wording, and amounts in portfolio news.
"""

from __future__ import annotations

import hashlib
import re
from datetime import date
from urllib.parse import unquote, urlparse

from .parse import Page, is_organisation
from .text import window

MAX_ITEMS = 6
PAGE_RULES = (
    ("portfolio", ("portfolio", "companies", "alumni")),
    ("terms", ("/deal", "deal", "faq", "investment-terms", "investment", "terms")),
    ("batches", ("cohort", "batch", "deadline", "dates", "timeline")),
    ("application", ("apply", "application")),
    ("details", ("eligibility", "about", "program", "overview", "accelerator")),
)
FORM_HOSTS = (
    "typeform.com", "airtable.com", "jotform.com", "f6s.com", "forms.gle", "docs.google.com",
    "hubspot.com", "submittable.com", "fluxx.io", "smapply.io", "gust.com", "dealum.com",
    "tally.so", "paperform.co", "formstack.com", "zohopublic.com", "notion.site", "wufoo.com",
)
ROLE_MAILBOXES = re.compile(
    r"^(?:info|hello|hi|hey|contact|contactus|contacts|apply|application|applications|admissions|"
    r"accelerator|program|programs|programme|programmes|startup|startups|founder|founders|team|"
    r"support|help|enquiries|inquiries|enquiry|inquiry|general|office|partnership|partnerships|"
    r"press|media|events|community|incubator|incubation|ventures|invest|investment|investments|"
    r"pitch|pitches|deals|dealflow|submission|submissions|connect|admin|mail|ask|questions|"
    r"innovation|entrepreneurship|cohort|selection)(?:[._-][a-z0-9]+)?$"
)
APPLICATION_MAILBOXES = re.compile(
    r"^(?:apply|application|applications|admissions|pitch|pitches|submission|submissions|dealflow|selection)\b"
)
EMAIL = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I)
MONTHS = {
    name: index
    for index, names in enumerate(
        (
            ("january", "jan"), ("february", "feb"), ("march", "mar"), ("april", "apr"),
            ("may",), ("june", "jun"), ("july", "jul"), ("august", "aug"),
            ("september", "sep", "sept"), ("october", "oct"), ("november", "nov"), ("december", "dec"),
        ),
        start=1,
    )
    for name in names
}
MONTH = r"(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\.?"
DATES = (
    re.compile(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?{MONTH},?\s+(20\d\d)\b", re.I),
    re.compile(rf"\b{MONTH}\s+(\d{{1,2}})(?:st|nd|rd|th)?,?\s+(20\d\d)\b", re.I),
    re.compile(r"\b(20\d\d)-(\d\d)-(\d\d)\b"),
)
DEADLINE_WORDS = re.compile(
    r"\b(?:deadline|applications?\s+(?:close|closes|closing|are due|due)|apply\s+(?:by|before)|"
    r"submissions?\s+close|closing\s+date|last\s+day\s+to\s+apply)\b",
    re.I,
)
DEADLINE_NOT_APPLICATION = re.compile(r"\b(?:refund|payment|fee|tuition|withdrawal|cancellation|early[- ]bird)\s*$", re.I)
OPEN_WORDS = re.compile(
    r"\bapplications?\s+(?:are|is)\s+(?:now\s+)?open\b|\bnow\s+accepting\s+applications\b|"
    r"\bapplications?\s+(?:are\s+)?now\s+open\b|\bwe\s+are\s+(?:now\s+)?accepting\s+applications\b",
    re.I,
)
CLOSED_WORDS = re.compile(
    r"\bapplications?\s+(?:are|is)\s+(?:now\s+)?closed\b|\bapplications?\s+(?:have|has)\s+closed\b|"
    r"\b(?:not|no longer)\s+(?:currently\s+)?accepting\s+applications\b",
    re.I,
)
STATUS_WORDS = (
    (
        "closed",
        re.compile(
            r"\b(?:program|programme|accelerator|incubator|fellowship)\s+(?:has|have)\s+(?:been\s+)?"
            r"(?:closed|discontinued|shut down|wound down|sunset)\b|\bceased\s+operations\b|"
            r"\bis\s+no\s+longer\s+(?:operating|running|active)\b",
            re.I,
        ),
    ),
    (
        "paused",
        re.compile(
            r"\b(?:program|programme|accelerator|incubator|fellowship|applications?)\s+(?:is|are|has been)\s+"
            r"(?:currently\s+|temporarily\s+)?(?:paused|on hold|on pause)\b",
            re.I,
        ),
    ),
)
BOUND = r"(less than|fewer than|under|below|about|around|approximately|roughly|over|more than|~)?\s*"
SELECTIVITY = (
    re.compile(rf"\b(?:acceptance|admission|admit)\s+rate\s+(?:of|is|was|:)?\s*{BOUND}(\d+(?:\.\d+)?)\s?%", re.I),
    re.compile(rf"\b{BOUND}(\d+(?:\.\d+)?)\s?%\s+(?:acceptance\s+rate|of\s+(?:all\s+)?(?:applicants|applications))\b", re.I),
    re.compile(
        rf"\baccept\w*\s+(?:only\s+)?{BOUND}(\d+(?:\.\d+)?)\s?%\s+of\s+(?:all\s+)?(?:the\s+)?"
        r"(?:applicants|applications|startups|companies|founders|teams)\b",
        re.I,
    ),
)
AMOUNT = re.compile(
    r"(?:[$€£¥₹]\s?\d[\d,.]*\s?(?:k|m|mm|million|thousand|b|bn|billion)?\b|"
    r"\b\d[\d,.]*\s?(?:k|m|million|thousand|b|bn|billion)?\s?(?:USD|EUR|GBP|SGD|CAD|AUD|INR|CHF|AED)\b|"
    r"\b(?:USD|EUR|GBP|SGD|CAD|AUD|INR|CHF|AED)\s?\d[\d,.]*\s?(?:k|m|million|thousand|b|bn|billion)?\b)",
    re.I,
)
OFFER_WORDS = re.compile(
    r"\b(?:we|will)\s+(?:invest|provide|offer|give)\b|\binvests?\s+(?:up to\s+)?(?:[$€£]|USD|EUR|GBP)|"
    r"\bin exchange for\b|\bche(?:ck|que) sizes?\b|\b(?:receive|get)\s+(?:up to\s+)?(?:[$€£]|USD|EUR|GBP)|"
    r"\bper (?:startup|company|team|founder)\b|\binvestment terms\b|\bgrant funding\b|\bstipend\b|"
    r"\bnon-dilutive\b|\bequity-free\b|\bgrant of\b|\bconvertible note\b|\bprogram fee\b|\bparticipation fee\b|"
    r"\bfor\s+\d+(?:\.\d+)?\s?%\s+(?:equity|of)\b|\bpre-money\b|\bpost-money\b|\bSAFE\b",
    re.I,
)
# A firm's own numbers (fund size, assets under management, portfolio results) are not what a
# startup receives, even when an offer word sits nearby ("We invest… a VC firm with $2.0B in AUM").
NEWS_WORDS = re.compile(
    r"\b(?:raises?|raised|raising|valuation|valued|series\s+[a-f]|ARR|revenue|exits?|acquired|unicorns?|"
    r"portfolio value|fund size|AUM|assets under management|under management|VC firm|venture (?:capital )?firm|"
    r"\$\d[\d.,]*\s?(?:b|bn|billion)|billion|news)\b",
    re.I,
)
# No accelerator check is this large; a bigger amount is a fund or portfolio figure.
MAX_PROGRAM_AMOUNT = 10_000_000
EXAMPLE_WORDS = re.compile(
    r"\b(?:sample|example|past|successful|winning|accepted)\s+applications?\b|\bapplications?\s+(?:examples?|samples?)\b",
    re.I,
)
PORTFOLIO_SEGMENTS = {
    "portfolio", "companies", "our-companies", "alumni", "startups", "our-portfolio",
    "portfolio-companies", "our-startups", "ventures", "cohorts",
}
PORTFOLIO_ANCHORS = {"portfolio", "our portfolio", "companies", "our companies", "alumni", "startups", "our startups"}
FINDING_KEYS = (
    "emails", "phones", "routes", "applicationUrl", "applicationsOpen", "operatingStatus",
    "deadlines", "rolling", "announcedIntake", "cohortStarts", "durationWeeks", "format",
    "location", "selectivity", "dealText", "dealComponents", "portfolioPages", "name", "examplePages",
)
MONTH_WORD = (
    r"(?:january|february|march|april|may|june|july|august|september|october|november|december|"
    r"jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)\.?"
)
SEASON_OR_MONTH = rf"(?:{MONTH_WORD}|spring|summer|autumn|fall|winter)"
ROLLING_WORDS = re.compile(
    r"\brolling\s+(?:admissions|applications|intake|basis|deadlines?)\b|"
    r"\bapplications?\s+(?:are\s+)?(?:accepted|open)\s+(?:year-round|on a rolling basis)\b|"
    r"\bon a rolling basis\b",
    re.I,
)
ANNOUNCED_INTAKE = re.compile(
    rf"\b(?:deadline|applications?\s+(?:close|closes|open|due)|apply\s+by|cohort|batch)\b.{{0,40}}?\b({SEASON_OR_MONTH})\b",
    re.I,
)
COHORT_START = re.compile(
    rf"\b(?:cohort|program|programme|batch)\s+(?:starts|begins|kicks off|runs)\s+(?:in\s+)?({SEASON_OR_MONTH})(?:\s+(20\d\d))?",
    re.I,
)
DURATION = re.compile(r"\b(\d{1,2})\s*-\s*(week|month)s?\b|\b(\d{1,2})\s+(week|month)s?\b", re.I)
FORMAT_WORDS = re.compile(
    r"\b(in-person|in person|hybrid|remote|virtual)(?!\s+(?:office|tour|event|events|room|desk|space|parking))\b",
    re.I,
)
LOCATION_WORDS = re.compile(
    r"\b(?:based|located|headquartered)\s+in\s+([A-Z][A-Za-z&'-]+(?:\s+[A-Z][A-Za-z&'-]+){0,3})"
)
MONEY = re.compile(
    r"(?P<prefix>[$€£¥₹]|USD|EUR|GBP|SGD|CAD|AUD|INR|CHF|AED)\s?(?P<num>\d[\d,]*(?:\.\d+)?)\s?(?P<scale>k|m|mm|million|thousand|b|bn|billion)?\b|"
    r"\b(?P<num2>\d[\d,]*(?:\.\d+)?)\s?(?P<scale2>k|m|million|thousand|b|bn|billion)?\s?(?P<suffix>USD|EUR|GBP|SGD|CAD|AUD|INR|CHF|AED)\b",
    re.I,
)
CURRENCY = {
    "$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR",
    "usd": "USD", "eur": "EUR", "gbp": "GBP", "sgd": "SGD", "cad": "CAD", "aud": "AUD",
    "inr": "INR", "chf": "CHF", "aed": "AED", "jpy": "JPY",
}
SCALE = {
    "k": 1_000, "thousand": 1_000, "m": 1_000_000, "mm": 1_000_000, "million": 1_000_000,
    "b": 1_000_000_000, "bn": 1_000_000_000, "billion": 1_000_000_000,
}


# Site plumbing, never a Program page, whatever its query string mentions.
PLUMBING = re.compile(r"/(?:wp-login\.php|wp-admin|xmlrpc\.php|logout|feed|cart)(?:[/?#]|$)", re.I)


def classify(url: str, anchor: str) -> str:
    """Which kind of official page a link points to, from its URL and anchor text."""
    hay = f"{url} {anchor}".lower()
    if PLUMBING.search(url) or any(
        skip in hay for skip in ("terms of use", "terms-of-use", "privacy", "cookie")
    ):
        return "other"
    for page, words in PAGE_RULES:
        if any(word in hay for word in words):
            return page
    return "other"


def _host(url: str) -> str:
    return urlparse(url).netloc.lower().removeprefix("www.")


def same_site(url: str, seeds: list[str]) -> bool:
    """True when url is the seed host, a subdomain of it, or the same host with or without www."""
    host = _host(url)
    return any(host == _host(seed) or host.endswith("." + _host(seed)) for seed in seeds)


def base_domain(host: str) -> str:
    labels = host.lower().removeprefix("www.").split(".")
    if len(labels) >= 3 and len(labels[-1]) == 2 and labels[-2] in {"co", "com", "org", "ac", "gov", "net", "edu"}:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def evidence_id(kind: str, *parts: str) -> str:
    return f"check-{kind}-{hashlib.sha1(chr(0).join(parts).encode()).hexdigest()[:10]}"


def parse_date(match: re.Match[str]) -> date | None:
    groups = match.groups()
    try:
        if len(groups) == 3 and groups[0].isdigit() and len(groups[0]) == 4:
            return date(int(groups[0]), int(groups[1]), int(groups[2]))
        if groups[0].isdigit():
            return date(int(groups[2]), MONTHS[groups[1].lower().rstrip(".")], int(groups[0]))
        return date(int(groups[2]), MONTHS[groups[0].lower().rstrip(".")], int(groups[1]))
    except (KeyError, ValueError):
        return None


class Findings:
    """Everything the checked pages of one Program state, each with its cited excerpt."""

    def __init__(self, program: dict, today: date) -> None:
        self.program = program
        self.today = today
        self.domains = {
            base_domain(urlparse(url).netloc)
            for url in [program["websiteUrl"], program["applyUrl"], *(source["url"] for source in program["sources"])]
        }
        self.evidence: dict[str, dict[str, str]] = {}
        self.found: dict[str, list[dict[str, object]]] = {key: [] for key in FINDING_KEYS}

    def cite(self, kind: str, url: str, page: str, excerpt: str, title: str) -> str:
        identifier = evidence_id(kind, url, excerpt)
        self.evidence.setdefault(identifier, {"id": identifier, "url": url, "title": title, "excerpt": excerpt, "page": page})
        return identifier

    def add(self, key: str, value: object, evidence: str) -> None:
        items = self.found[key]
        if len(items) < MAX_ITEMS and all(item["value"] != value for item in items):
            items.append({"value": value, "evidenceId": evidence})

    def public_mailbox(self, address: str) -> bool:
        local, at, domain = address.partition("@")
        return bool(at) and bool(ROLE_MAILBOXES.match(local)) and base_domain(domain) in self.domains

    def read(self, url: str, kind: str, page: Page) -> None:
        name = self.program["name"]
        homepage = url == self.program["websiteUrl"]
        page_name = "homepage" if homepage else "program page" if kind == "details" else f"{kind} page"
        title = f"{name} — {page_name}"
        text = page.visible()
        at = text.lower().find(name.lower())
        if at >= 0 and homepage:
            self.add("name", name, self.cite("name", url, kind, window(text, at, at + len(name), 60), title))
        self._links(url, kind, page, title)
        self._structured(url, kind, page, title)
        self._contacts(url, kind, text, title)
        self._status(url, kind, text, title)
        self._deadlines(url, kind, text, title)
        self._intake(url, kind, text, title)
        self._program_shape(url, kind, text, title)
        self._selectivity(url, kind, text, title)
        self._deal(url, kind, text, title)

    def _links(self, url: str, kind: str, page: Page, title: str) -> None:
        for anchor in page.anchors:
            href, text = anchor.href, anchor.text
            lowered = href.lower()
            if lowered.startswith("mailto:"):
                address = unquote(href[7:].split("?")[0]).strip().lower()
                if self.public_mailbox(address):
                    excerpt = f"{text} ({address})" if text and address not in text.lower() else text or address
                    evidence = self.cite("email", url, kind, excerpt, title)
                    self.add("emails", address, evidence)
                    if APPLICATION_MAILBOXES.match(address):
                        self.add("routes", f"mailto:{address}", evidence)
            elif lowered.startswith("tel:"):
                number = unquote(href[4:]).strip()
                if len(re.sub(r"\D", "", number)) >= 8:
                    excerpt = text if text and re.search(r"\d", text) else f"{text} ({number})".strip()
                    self.add("phones", number, self.cite("phone", url, kind, excerpt, title))
            elif urlparse(href).scheme in {"http", "https"}:
                self._link(url, kind, href, text, title)

    def _link(self, url: str, kind: str, href: str, text: str, title: str) -> None:
        page = classify(href, text)
        host = urlparse(href).netloc.lower()
        official = same_site(href, [self.program["websiteUrl"], self.program["applyUrl"]])
        excerpt = f"{text} → {href}" if text else href
        if href.rstrip("/") == self.program["applyUrl"].rstrip("/") and not self.found["applicationUrl"]:
            self.add("applicationUrl", href, self.cite("route", url, kind, excerpt, title))
        if href.split("#")[0].rstrip("/") == url.split("#")[0].rstrip("/"):
            return
        if EXAMPLE_WORDS.search(f"{text} {urlparse(href).path.replace('-', ' ')}"):
            self.add("examplePages", href, self.cite("example", url, kind, excerpt, title))
        if page == "application" and (official or any(host.endswith(form) for form in FORM_HOSTS)):
            evidence = self.cite("route", url, kind, excerpt, title)
            self.add("routes", href, evidence)
            if official and not self.found["applicationUrl"]:
                self.add("applicationUrl", href, evidence)
        segment = urlparse(href).path.rstrip("/").rsplit("/", 1)[-1].lower()
        if official and (segment in PORTFOLIO_SEGMENTS or text.lower() in PORTFOLIO_ANCHORS):
            self.add("portfolioPages", href, self.cite("portfolio", url, kind, excerpt, title))

    def _structured(self, url: str, kind: str, page: Page, title: str) -> None:
        """Contacts the site declares about itself in schema.org JSON-LD."""
        for item in page.structured():
            if not is_organisation(item):
                continue
            for raw in _strings(item.get("email")):
                address = raw.removeprefix("mailto:").strip().lower()
                if self.public_mailbox(address):
                    self.add("emails", address, self.cite("email", url, kind, f'"email": "{raw}"', title))
            for raw in _strings(item.get("telephone")):
                if len(re.sub(r"\D", "", raw)) >= 8:
                    self.add("phones", raw.strip(), self.cite("phone", url, kind, f'"telephone": "{raw}"', title))

    def _contacts(self, url: str, kind: str, text: str, title: str) -> None:
        for match in EMAIL.finditer(text):
            address = match.group(0).lower().rstrip(".")
            if self.public_mailbox(address):
                self.add("emails", address, self.cite("email", url, kind, window(text, match.start(), match.end(), 60), title))

    def _status(self, url: str, kind: str, text: str, title: str) -> None:
        for pattern, value in ((OPEN_WORDS, True), (CLOSED_WORDS, False)):
            match = pattern.search(text)
            if match:
                self.add("applicationsOpen", value, self.cite("status", url, kind, window(text, match.start(), match.end(), 110), title))
        for status, pattern in STATUS_WORDS:
            match = pattern.search(text)
            if match:
                self.add("operatingStatus", status, self.cite("status", url, kind, window(text, match.start(), match.end(), 110), title))

    def _deadlines(self, url: str, kind: str, text: str, title: str) -> None:
        """A future date with a year, right after deadline wording or right before 'Final Deadline'."""
        for keyword in DEADLINE_WORDS.finditer(text):
            if DEADLINE_NOT_APPLICATION.search(text[max(0, keyword.start() - 30) : keyword.start()]):
                continue
            after = (keyword.end(), text[keyword.end() : keyword.end() + 50])
            before = (max(0, keyword.start() - 30), text[max(0, keyword.start() - 30) : keyword.start()])
            for offset, span in (after, before):
                matches = [match for pattern in DATES for match in pattern.finditer(span)]
                if offset == before[0]:
                    matches = [
                        match for match in matches
                        if span[match.end() :].strip(" —–-:|,").lower() in {"", "final", "application", "applications"}
                    ]
                if not matches:
                    continue
                match = min(matches, key=lambda item: item.start()) if offset == after[0] else matches[-1]
                day = parse_date(match)
                if day is not None and day >= self.today:
                    start, end = offset + match.start(), offset + match.end()
                    excerpt = window(text, min(start, keyword.start()), max(end, keyword.end()), 60)
                    self.add("deadlines", day.isoformat(), self.cite("deadline", url, kind, excerpt, title))
                break

    def _intake(self, url: str, kind: str, text: str, title: str) -> None:
        """Rolling intake, and months or seasons that have no year. A year is never invented."""
        match = ROLLING_WORDS.search(text)
        if match:
            self.add("rolling", True, self.cite("rolling", url, kind, window(text, match.start(), match.end(), 80), title))
        for found in ANNOUNCED_INTAKE.finditer(text):
            around = text[max(0, found.start() - 12) : found.end() + 20]
            if re.search(r"20\d\d", around):
                continue
            label = found.group(1).rstrip(".")
            self.add("announcedIntake", label, self.cite("announced", url, kind, window(text, found.start(), found.end(), 70), title))
        for found in COHORT_START.finditer(text):
            label = found.group(1).rstrip(".")
            year = found.group(2)
            value = f"{label} {year}" if year else label
            self.add("cohortStarts", value, self.cite("start", url, kind, window(text, found.start(), found.end(), 60), title))

    def _program_shape(self, url: str, kind: str, text: str, title: str) -> None:
        for match in DURATION.finditer(text):
            number = match.group(1) or match.group(3)
            unit = (match.group(2) or match.group(4) or "").lower()
            if not number or not unit:
                continue
            value = number if unit.startswith("week") else ("1 month" if number == "1" else f"{number} months")
            self.add("durationWeeks", value, self.cite("duration", url, kind, window(text, match.start(), match.end(), 50), title))
        for match in FORMAT_WORDS.finditer(text):
            raw = match.group(1).lower().replace(" ", "-")
            value = {"virtual": "remote", "in-person": "in-person", "remote": "remote", "hybrid": "hybrid"}[raw]
            self.add("format", value, self.cite("format", url, kind, window(text, match.start(), match.end(), 60), title))
        match = LOCATION_WORDS.search(text)
        if match:
            self.add("location", match.group(1).strip(" .,"), self.cite("location", url, kind, window(text, match.start(), match.end(), 40), title))

    def _selectivity(self, url: str, kind: str, text: str, title: str) -> None:
        for pattern in SELECTIVITY:
            for match in pattern.finditer(text):
                bound, number = match.group(1), match.group(2)
                rate = None if bound else round(float(number) / 100, 6)
                excerpt = window(text, match.start(), match.end(), 80)
                self.add("selectivity", {"rate": rate, "bounded": bool(bound)}, self.cite("selectivity", url, kind, excerpt, title))

    def _deal(self, url: str, kind: str, text: str, title: str) -> None:
        """An amount next to offer wording ('we invest $150K for 7%'), never next to news wording."""
        for match in AMOUNT.finditer(text):
            local = text[max(0, match.start() - 90) : match.end() + 70]
            near = text[max(0, match.start() - 40) : match.end() + 40]
            if not OFFER_WORDS.search(local) or NEWS_WORDS.search(near):
                continue
            component = _component(match.group(), local, match.start() - max(0, match.start() - 90))
            if component is not None and component["amount"] and int(component["amount"]) > MAX_PROGRAM_AMOUNT:
                continue
            excerpt = window(text, match.start(), match.end(), 70)
            evidence = self.cite("deal", url, kind, excerpt, title)
            self.add("dealText", excerpt, evidence)
            if component is not None:
                self.add("dealComponents", component, evidence)
            if re.search(r"\bno fees\b|\bwithout fees\b|\bfee-free\b|\bno program fee\b", local, re.I):
                self.add(
                    "dealComponents",
                    {"kind": "fee", "amount": "0", "currency": None, "equity": None, "label": "Fee", "contingent": False, "condition": "no fees"},
                    evidence,
                )


def _parsed_money(match: re.Match[str]) -> tuple[str, str] | None:
    if match.group("num"):
        number, scale, symbol = match.group("num"), match.group("scale"), match.group("prefix")
    else:
        number, scale, symbol = match.group("num2"), match.group("scale2"), match.group("suffix")
    if not number or not symbol:
        return None
    try:
        value = float(number.replace(",", ""))
    except ValueError:
        return None
    if scale:
        value *= SCALE[scale.lower()]
    rounded = int(round(value))
    if rounded < 1 or abs(value - rounded) > 0.01 or rounded > 1_000_000_000_000:
        return None
    return str(rounded), CURRENCY[symbol.lower()]


def _instrument(local: str, amount_at: int) -> str:
    """The offer word closest to the amount, so a later fee is not labelled with an earlier SAFE."""
    patterns = (
        ("safe", re.compile(r"\bSAFE\b")),
        ("convertible", re.compile(r"\bconvertible(?:\s+note)?\b", re.I)),
        ("grant", re.compile(r"equity[-\s]?free|\bnon-dilutive\b|\bno equity\b|\bgrants?\b", re.I)),
        ("fee", re.compile(r"\b(?:program|participation|tuition)\s+fees?\b|\bfees?\b", re.I)),
        ("equity", re.compile(r"\b(?:for\s+)?\d+(?:\.\d+)?\s?%\s+equity\b|\bequity\b", re.I)),
    )
    best = "cash"
    best_distance = 10**9
    for kind, pattern in patterns:
        for found in pattern.finditer(local):
            distance = min(abs(found.start() - amount_at), abs(found.end() - amount_at))
            if distance < best_distance:
                best, best_distance = kind, distance
    return best


def _component(amount_text: str, local: str, amount_at: int) -> dict | None:
    money = next((parsed for match in MONEY.finditer(amount_text) if (parsed := _parsed_money(match))), None)
    equity_match = re.search(r"(\d+(?:\.\d+)?)\s?%", local)
    equity = None
    if equity_match and re.search(r"equity|SAFE|convertible|ownership", local, re.I):
        equity = equity_match.group(1) + "%"
    kind = _instrument(local, amount_at)
    if money is None and equity is None and kind not in {"grant", "fee"}:
        return None
    amount, currency = money if money else (None, None)
    contingent = bool(re.search(r"\bup to\b|\bmaximum of\b", local, re.I))
    labels = {"safe": "SAFE", "convertible": "Convertible note", "grant": "Grant", "fee": "Fee", "equity": "Equity", "cash": "Cash"}
    return {
        "kind": kind,
        "amount": amount,
        "currency": currency if amount else None,
        "equity": equity,
        "label": labels[kind],
        "contingent": contingent,
        "condition": "up to" if contingent else None,
    }


def _strings(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str)]
    return []
