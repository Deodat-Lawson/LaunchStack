"""Read one HTML page: visible text, links, logo candidates, and structured data."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

from .text import collapse

HIDDEN = {"script", "style", "noscript", "svg"}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
LABELS = {"h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "dt"}
HEADER_LOGO, BODY_LOGO, TOUCH_ICON, ICON, NAMED_HEADER_IMAGE, DECLARED_LOGO = range(6)
RANK_ORDER = {DECLARED_LOGO: 0, HEADER_LOGO: 1, NAMED_HEADER_IMAGE: 2, BODY_LOGO: 3, TOUCH_ICON: 4, ICON: 5}


@dataclass
class Anchor:
    href: str
    text: str
    title: str
    heading: str
    """The nearest h1-h6 before the link."""
    bold: str
    """Bold or dt text after that heading and before the link; empty when there is none."""


@dataclass
class Candidate:
    rank: int
    order: int
    url: str
    hint: str


class Page(HTMLParser):
    def __init__(self, base: str) -> None:
        super().__init__(convert_charrefs=True)
        self.base = base
        self.parts: list[str] = []
        self.anchors: list[Anchor] = []
        self.candidates: list[Candidate] = []
        self.structured_blocks: list[str] = []
        self._hidden = 0
        self._chrome = 0
        self._logo_scopes: list[str] = []
        self._href: str | None = None
        self._title = ""
        self._anchor_text: list[str] = []
        self._heading = ""
        self._bold = ""
        self._label_tag: str | None = None
        self._label_text: list[str] = []
        self._json_ld: list[str] | None = None

    @classmethod
    def read(cls, base: str, html: str) -> "Page":
        page = cls(base)
        page.feed(html)
        page.close()
        return page

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key: value or "" for key, value in attrs}
        if tag == "script" and "ld+json" in values.get("type", "").lower():
            self._json_ld = []
        if tag in HIDDEN:
            self._hidden += 1
        names = f"{values.get('class', '')} {values.get('id', '')}".lower()
        if tag in {"header", "nav"}:
            self._chrome += 1
        if tag in LABELS and self._label_tag is None:
            self._label_tag, self._label_text = tag, []
        if tag == "a" and values.get("href"):
            self._href, self._title, self._anchor_text = values["href"].strip(), values.get("title", ""), []
        if tag not in VOID and "logo" in names:
            self._logo_scopes.append(tag)
        if tag in {"img", "source"}:
            self._image(values, names)
        elif tag == "link":
            rel = values.get("rel", "").lower().split()
            if "apple-touch-icon" in rel:
                self._add(TOUCH_ICON, values.get("href"))
            elif "icon" in rel:
                self._add(ICON, values.get("href"))

    def _image(self, values: dict[str, str], names: str) -> None:
        srcset = values.get("srcset", "").split()
        src = values.get("src") or values.get("data-src") or (srcset[0] if srcset else "")
        path = urlparse(src).path.lower()
        alt = values.get("alt", "")
        label = alt if len(alt.split()) <= 5 else ""
        hint = f"{path.rsplit('/', 1)[-1]} {label} {names}".lower()
        home = self._href is not None and urlparse(urljoin(self.base, self._href)).path in {"", "/"}
        if "logo" in f"{path} {hint}" or self._logo_scopes:
            self._add(HEADER_LOGO if self._chrome else BODY_LOGO, src, hint)
        elif self._chrome and (home or re.search(r"wordmark|brand", path)):
            self._add(HEADER_LOGO, src, hint)
        elif self._chrome and label:
            self._add(NAMED_HEADER_IMAGE, src, hint)

    def _add(self, rank: int, url: str | None, hint: str = "") -> None:
        if not url or url.startswith("data:"):
            return
        absolute = urljoin(self.base, url.strip())
        if urlparse(absolute).scheme in {"http", "https"}:
            self.candidates.append(Candidate(rank, len(self.candidates), absolute, hint))

    def handle_data(self, data: str) -> None:
        if self._json_ld is not None:
            self._json_ld.append(data)
        if self._hidden == 0 and data.strip():
            self.parts.append(data)
        if self._href is not None:
            self._anchor_text.append(data)
        if self._label_tag is not None:
            self._label_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._json_ld is not None:
            self.structured_blocks.append("".join(self._json_ld))
            self._json_ld = None
        if tag in HIDDEN and self._hidden:
            self._hidden -= 1
        if tag == self._label_tag:
            label = collapse(" ".join(self._label_text))
            if label and tag.startswith("h"):
                self._heading, self._bold = label, ""
            elif label:
                self._bold = label
            self._label_tag = None
        if tag == "a" and self._href is not None:
            href = self._href
            if not href.lower().startswith(("mailto:", "tel:")):
                href = urljoin(self.base, href)
            self.anchors.append(Anchor(href, collapse(" ".join(self._anchor_text)), collapse(self._title), self._heading, self._bold))
            self._href = None
        if tag in {"header", "nav"} and self._chrome:
            self._chrome -= 1
        if self._logo_scopes and self._logo_scopes[-1] == tag:
            self._logo_scopes.pop()

    def close(self) -> None:
        super().close()
        for item in self.structured():
            logo = item.get("logo")
            if isinstance(logo, dict):
                logo = logo.get("url") or logo.get("contentUrl")
            if isinstance(logo, str) and is_organisation(item):
                self._add(DECLARED_LOGO, logo, f"{item.get('name', '')} logo".lower())

    def visible(self) -> str:
        return collapse(" ".join(self.parts))

    def structured(self) -> list[dict]:
        """schema.org objects the site declares in JSON-LD, flattened out of @graph and lists."""
        found: list[dict] = []

        def walk(node: object) -> None:
            if isinstance(node, list):
                for item in node:
                    walk(item)
            elif isinstance(node, dict):
                found.append(node)
                walk(node.get("@graph", []))

        for block in self.structured_blocks:
            try:
                walk(json.loads(block))
            except ValueError:
                continue
        return found


def is_organisation(item: dict) -> bool:
    kinds = item.get("@type", [])
    kinds = [kinds] if isinstance(kinds, str) else kinds
    return any(isinstance(kind, str) and re.search(r"Organi[sz]ation|Corporation|NGO|College|University|LocalBusiness", kind) for kind in kinds)
