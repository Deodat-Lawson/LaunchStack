"""
CriticMarkup → structured review model.

`adeu.extract_text_from_stream` returns the document as CriticMarkup: the body
text with tracked changes wrapped in `{++inserted++}` / `{--deleted--}` /
`{~~old~>new~~}` / `{==highlighted==}` spans, each followed by a `{>>…<<}`
metadata block naming the revision ids and their authors.

Nothing in adeu's public API hands a caller that list as data — the ids live in
the markup, which is how the CLI and the MCP server are meant to consume them.
A UI needs them as objects: to render a review pane, to let a human accept or
reject one change, and to send back `target_id`s that mean something. This
module is that translation, and it is the only place in the service that knows
the markup's shape.

Metadata block grammar (adeu 2.4.x, `ingest._build_merged_meta_block`):

    [Chg:12 insert] Jane Doe
    [Chg:13 delete] Jane Doe (pairs with 12)
    [Chg:14 format] Jane Doe
    [Com:5] Bob Smith @ 2026-08-01T10:00:00Z: please double-check this clause

Change lines come first, then comment lines, newline-joined inside one
`{>>…<<}` marker. Comment bodies may themselves contain newlines, so comment
parsing continues a line into the previous entry when it does not start a new
`[Id]` header.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterator

from app.schemas.adeu import ReviewItem

# --- CriticMarkup span syntax -------------------------------------------------
# Non-greedy with DOTALL: spans legitimately wrap newlines (a deleted table row
# spans lines), but must never swallow the next span's opener.
_SPAN_RE = re.compile(
    r"""
    \{\+\+(?P<ins>.*?)\+\+\}
  | \{--(?P<del>.*?)--\}
  | \{~~(?P<sub_old>.*?)~>(?P<sub_new>.*?)~~\}
  | \{==(?P<hl>.*?)==\}
    """,
    re.DOTALL | re.VERBOSE,
)

_META_RE = re.compile(r"\{>>(?P<body>.*?)<<\}", re.DOTALL)

_CHANGE_LINE_RE = re.compile(
    r"^\[(?P<id>Chg:[^\]\s]+)\s+(?P<kind>insert|delete|format)\]\s*"
    r"(?P<author>.*?)"
    r"(?:\s*\(pairs with (?P<pair>[^)]+)\))?\s*$"
)

# The date is an ISO-8601 timestamp, which contains colons — so it cannot be
# matched as "everything up to the next colon" without eating into the body.
# Anchoring it to a date shape keeps the separator unambiguous.
_ISO_DATE = r"\d{4}-\d{2}-\d{2}(?:[T ][0-9:.]+(?:Z|[+-][0-9:]+)?)?"

_COMMENT_LINE_RE = re.compile(
    r"^\[(?P<id>Com:[^\]]+)\]\s*"
    r"(?P<author>.*?)"
    rf"(?:\s*@\s*(?P<date>{_ISO_DATE}))?"
    r"\s*:\s*(?P<text>.*)$",
    re.DOTALL,
)

# A span is bound to the metadata block that immediately follows it. adeu emits
# them adjacent, but tolerate incidental whitespace between the two.
_ADJACENT_WS = re.compile(r"\s*")

_CONTEXT_CHARS = 90


def _clean(text: str) -> str:
    """Collapse whitespace for display fields. The document text itself is
    never rewritten by this — only the short labels shown in a review pane."""
    return re.sub(r"\s+", " ", text).strip()


def _snippet(text: str, limit: int = 240) -> str:
    text = _clean(text)
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _context_around(markup: str, start: int, end: int) -> str:
    """A short window of surrounding document text, with markup syntax stripped,
    so the review pane can show where a change sits."""
    left = markup[max(0, start - _CONTEXT_CHARS) : start]
    right = markup[end : end + _CONTEXT_CHARS]
    return _snippet(f"{strip_markup(left)}…{strip_markup(right)}", limit=200)


def strip_markup(text: str) -> str:
    """Render CriticMarkup as its accepted ("clean") text: insertions kept,
    deletions dropped, substitutions resolved to the new value, metadata
    removed. Used for context snippets, not as a substitute for adeu's own
    `clean_view` extraction, which resolves the real document state."""
    text = _META_RE.sub("", text)

    def _resolve(m: re.Match[str]) -> str:
        if m.group("ins") is not None:
            return m.group("ins")
        if m.group("del") is not None:
            return ""
        if m.group("sub_new") is not None:
            return m.group("sub_new")
        return m.group("hl") or ""

    return _SPAN_RE.sub(_resolve, text)


@dataclass(frozen=True)
class _Span:
    """One CriticMarkup span and where it sits in the markup."""

    text: str
    kind: str
    start: int
    end: int


def _preceding_span_group(
    markup: str, meta_start: int, spans_by_end: dict[int, _Span]
) -> list[_Span]:
    """Collect the run of spans immediately before a metadata block.

    A replacement is emitted as two adjacent spans sharing one block —
    ``{--old--}{++new++}{>>[Chg:1 delete] …\\n[Chg:2 insert] …<<}`` — so the
    block describes the whole run, not just the span touching it. Returned in
    document order.
    """
    group: list[_Span] = []
    probe = meta_start
    while True:
        while probe > 0 and markup[probe - 1].isspace():
            probe -= 1
        span = spans_by_end.get(probe)
        if span is None:
            break
        group.append(span)
        probe = span.start
    group.reverse()
    return group


def _span_for_kind(group: list[_Span], kind: str) -> _Span | None:
    """Pick the span a metadata entry describes, by its kind.

    Falls back to the last span in the run so an unfamiliar pairing still
    reports *something* rather than an empty label.
    """
    if not group:
        return None
    wanted = {"insert": "insert", "delete": "delete"}.get(kind)
    if wanted:
        for span in group:
            if span.kind == wanted:
                return span
        for span in group:
            if span.kind == "substitute":
                return span
    if kind == "comment":
        for span in group:
            if span.kind == "highlight":
                return span
    return group[-1]


def _iter_meta_entries(body: str) -> Iterator[tuple[str, dict[str, str | None]]]:
    """Yield (id, fields) for every entry in one metadata block.

    Comment bodies can wrap across lines; a line that does not open a new
    `[Chg:…]`/`[Com:…]` header is appended to the entry being built.
    """
    pending_id: str | None = None
    pending: dict[str, str | None] | None = None

    for raw_line in body.split("\n"):
        line = raw_line.strip()
        if not line:
            if pending is not None and pending.get("kind") == "comment":
                pending["text"] = f"{pending.get('text') or ''}\n"
            continue

        change = _CHANGE_LINE_RE.match(line)
        if change:
            if pending_id and pending:
                yield pending_id, pending
            pending_id = change.group("id")
            pending = {
                "kind": change.group("kind"),
                "author": _clean(change.group("author")) or "Unknown",
                "date": None,
                "text": None,
                "paired_with": (
                    f"Chg:{change.group('pair').strip()}"
                    if change.group("pair")
                    and not change.group("pair").strip().startswith("Chg:")
                    else (change.group("pair").strip() if change.group("pair") else None)
                ),
            }
            continue

        comment = _COMMENT_LINE_RE.match(line)
        if comment:
            if pending_id and pending:
                yield pending_id, pending
            pending_id = comment.group("id")
            pending = {
                "kind": "comment",
                "author": _clean(comment.group("author") or "") or "Unknown",
                "date": _clean(comment.group("date") or "") or None,
                "text": comment.group("text"),
                "paired_with": None,
            }
            continue

        # Continuation of a multi-line comment body.
        if pending is not None and pending.get("kind") == "comment":
            pending["text"] = f"{(pending.get('text') or '').rstrip()}\n{line}"

    if pending_id and pending:
        yield pending_id, pending


def parse_review_items(markup: str) -> list[ReviewItem]:
    """Extract every tracked change and comment from CriticMarkup text.

    Ids are returned exactly as adeu writes them (`Chg:12`, `Com:5`), so they
    round-trip straight back into a review action's `target_id`.

    Ordering follows first appearance in the document, which is the order a
    reader encounters them — a review pane should not have to re-sort.
    """
    items: dict[str, ReviewItem] = {}
    order: list[str] = []

    # Spans indexed by end offset, so a metadata block can find what precedes it.
    spans_by_end: dict[int, _Span] = {}
    for m in _SPAN_RE.finditer(markup):
        if m.group("ins") is not None:
            payload, kind = m.group("ins"), "insert"
        elif m.group("del") is not None:
            payload, kind = m.group("del"), "delete"
        elif m.group("sub_new") is not None:
            payload, kind = f"{m.group('sub_old')} → {m.group('sub_new')}", "substitute"
        else:
            payload, kind = (m.group("hl") or ""), "highlight"
        spans_by_end[m.end()] = _Span(text=payload, kind=kind, start=m.start(), end=m.end())

    for meta in _META_RE.finditer(markup):
        group = _preceding_span_group(markup, meta.start(), spans_by_end)
        group_start = group[0].start if group else meta.start()

        for item_id, fields in _iter_meta_entries(meta.group("body")):
            if item_id in items:
                continue

            kind = fields["kind"] or "comment"
            span = _span_for_kind(group, kind)
            span_text = span.text if span else ""

            if kind == "comment":
                # A comment's own body is its text; the span it sits on is what
                # it is *about*.
                body = fields["text"] or ""
                anchor = span_text
            else:
                # A revision's text is the span it wrote — the deleted words for
                # a delete, the inserted words for an insert. Binding both
                # halves of a replacement to the same span would report the
                # deletion as if it had inserted the new text.
                body = span_text
                anchor = span_text

            items[item_id] = ReviewItem(
                id=item_id,
                kind=kind,  # type: ignore[arg-type]
                author=fields["author"] or "Unknown",
                date=fields["date"],
                text=_snippet(body),
                anchor_text=_snippet(anchor, limit=160),
                paired_with=fields["paired_with"],
                offset=span.start if span else group_start,
                context=_context_around(markup, group_start, meta.end()),
            )
            order.append(item_id)

    ordered = sorted(order, key=lambda i: (items[i].offset, i))
    return [items[i] for i in ordered]
