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
    ("terms", ("/deal", "deal", "faq", "investment-terms")),
    ("batches", ("cohort", "batch", "deadline", "dates")),
    ("application", ("apply", "application")),
    ("details", ("about", "program", "overview")),
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
    r"(?:[$€£¥₹]\s?\d[\d,.]*\s?(?:k|m|mm|million|thousand|bn)?\b|"
    r"\b\d[\d,.]*\s?(?:k|m|million|thousand)?\s?(?:USD|EUR|GBP|SGD|CAD|AUD|INR|CHF|AED)\b|"
    r"\b(?:USD|EUR|GBP|SGD|CAD|AUD|INR|CHF|AED)\s?\d[\d,.]*\s?(?:k|m|million|thousand)?\b)",
    re.I,
)
OFFER_WORDS = re.compile(
    r"\b(?:we|will)\s+(?:invest|provide|offer|give)\b|\binvests?\s+(?:up to\s+)?(?:[$€£]|USD|EUR|GBP)|"
    r"\bin exchange for\b|\bche(?:ck|que) sizes?\b|\b(?:receive|get)\s+(?:up to\s+)?(?:[$€£]|USD|EUR|GBP)|"
    r"\bper (?:startup|company|team|founder)\b|\binvestment terms\b|\bgrant funding\b|\bstipend\b|"
    r"\bnon-dilutive\b|\bfor\s+\d+(?:\.\d+)?\s?%\s+(?:equity|of)\b|\bpre-money\b|\bpost-money\b|\bSAFE\b",
    re.I,
)
NEWS_WORDS = re.compile(
    r"\b(?:raises?|raised|raising|valuation|valued|series\s+[a-f]|ARR|revenue|exits?|acquired|unicorns?|"
    r"portfolio value|fund size|\$\d[\d.,]*\s?(?:bn|billion)|news)\b",
    re.I,
)
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
    "deadlines", "selectivity", "dealText", "portfolioPages", "name", "examplePages",
)


def classify(url: str, anchor: str) -> str:
    """Which kind of official page a link points to, from its URL and anchor text."""
    hay = f"{url} {anchor}".lower()
    if any(skip in hay for skip in ("terms of use", "terms-of-use", "privacy", "cookie")):
        return "other"
    for page, words in PAGE_RULES:
        if any(word in hay for word in words):
            return page
    return "other"


def same_site(url: str, seeds: list[str]) -> bool:
    host = urlparse(url).netloc.lower()
    return any(host == urlparse(seed).netloc.lower() or host.endswith("." + urlparse(seed).netloc.lower()) for seed in seeds)


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
        title = f"{name} — {'homepage' if kind == 'details' and homepage else kind + ' page'} checked by scrape.py"
        text = page.visible()
        at = text.lower().find(name.lower())
        if at >= 0 and homepage:
            self.add("name", name, self.cite("name", url, kind, window(text, at, at + len(name), 60), title))
        self._links(url, kind, page, title)
        self._structured(url, kind, page, title)
        self._contacts(url, kind, text, title)
        self._status(url, kind, text, title)
        self._deadlines(url, kind, text, title)
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
            self.add("routes", href, self.cite("route", url, kind, excerpt, title))
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

    def _selectivity(self, url: str, kind: str, text: str, title: str) -> None:
        for pattern in SELECTIVITY:
            for match in pattern.finditer(text):
                bound, number = match.group(1), match.group(2)
                rate = None if bound else round(float(number) / 100, 6)
                excerpt = window(text, match.start(), match.end(), 80)
                self.add("selectivity", {"rate": rate, "bounded": bool(bound)}, self.cite("selectivity", url, kind, excerpt, title))

    def _deal(self, url: str, kind: str, text: str, title: str) -> None:
        """An amount next to offer wording ('we invest $150K for 7%'), never next to news wording."""
        covered = -1
        for match in AMOUNT.finditer(text):
            if match.start() < covered:
                continue
            local = text[max(0, match.start() - 80) : match.end() + 80]
            near = text[max(0, match.start() - 40) : match.end() + 40]
            if not OFFER_WORDS.search(local) or NEWS_WORDS.search(near):
                continue
            excerpt = window(text, match.start(), match.end(), 160)
            covered = match.end() + 160
            self.add("dealText", excerpt, self.cite("deal", url, kind, excerpt, title))


def _strings(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str)]
    return []
