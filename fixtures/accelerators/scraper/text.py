"""Text normalisation and the rules for deciding whether a stored quote is still on a page."""

from __future__ import annotations

import re

QUOTE_LIMIT = 1400
CHUNK_WORDS = 6
CHUNK_SHARE = 0.85
MIN_VISIBLE_TEXT = 150
BOT_WALLS = (
    "just a moment...",
    "attention required! | cloudflare",
    "verify you are human",
    "checking your browser",
    "enable javascript and cookies to continue",
    "access denied",
    "you are using an unsupported browser",
)


def collapse(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def loosen(value: str) -> str:
    """Ignore the space an HTML link leaves before punctuation."""
    return re.sub(r"\s+([.,;:!?])", r"\1", value)


def segments(quote: str) -> list[str]:
    """A quote may elide text with [...]; each remaining piece must be on the page."""
    parts = re.split(r"\[\s*…\s*\]|\[\s*\.\.\.\s*\]|\n+", quote)
    return [collapse(part) for part in parts if collapse(part)]


def searchable(visible: str, html: str) -> str:
    """Visible text plus the raw markup, so a quote taken from an attribute still matches."""
    raw = collapse(html.replace("&quot;", '"').replace("&#39;", "'").replace("&amp;", "&"))
    return loosen(visible + "\n" + raw)


def still_quoted(quote: str, haystack: str) -> bool:
    """Curated quotes: every segment must be on the page exactly."""
    return all(loosen(segment) in haystack for segment in segments(quote))


def mostly_quoted(quote: str, haystack: str) -> bool:
    """Homepage quotes: most six-word chunks must still be on the page. The first quotes were
    taken by a reader that reordered text and dropped page chrome, and homepages rotate news."""
    words = loosen(collapse(quote)).split()
    chunks = [" ".join(words[start : start + CHUNK_WORDS]) for start in range(0, len(words), CHUNK_WORDS)]
    if not chunks:
        return False
    return sum(chunk in haystack for chunk in chunks) / len(chunks) >= CHUNK_SHARE


def bot_wall(visible: str) -> str | None:
    """Why a page should not replace a stored quote, or None when it reads as real content."""
    if len(visible) < MIN_VISIBLE_TEXT:
        return f"The page returned {len(visible)} characters of visible text, which reads as empty or script-rendered."
    head = visible[:400].lower()
    for marker in BOT_WALLS:
        if marker in head:
            return f'The page returned a bot check ("{marker}") instead of program text.'
    return None


def clip(text: str, limit: int = QUOTE_LIMIT) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit]
    return cut[: cut.rfind(" ")].rstrip() if " " in cut else cut


def window(text: str, start: int, end: int, radius: int) -> str:
    """The match plus up to radius characters either side, cut on word boundaries."""
    left = max(0, start - radius)
    right = min(len(text), end + radius)
    if left > 0:
        space = text.find(" ", left)
        left = space + 1 if 0 <= space < start else left
    if right < len(text):
        space = text.rfind(" ", end, right)
        right = space if space > end else right
    return text[left:right].strip()
