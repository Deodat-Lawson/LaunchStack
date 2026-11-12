"""Choose, verify, and rasterize a Program's official logo."""

from __future__ import annotations

import re
import shutil
import subprocess
from datetime import datetime
from io import BytesIO
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse

from . import LOGOS, iso
from .net import Fetcher
from .outcome import Outcome
from .parse import BODY_LOGO, DECLARED_LOGO, ICON, NAMED_HEADER_IMAGE, RANK_ORDER, TOUCH_ICON, Page

LOGO_EDGE = 512
MIN_ICON_EDGE = 64
GENERIC_NAME_WORDS = {
    "the", "and", "for", "startup", "startups", "accelerator", "incubator", "ventures", "venture",
    "capital", "labs", "lab", "program", "programme", "fund", "innovation", "global", "partners", "hub",
}
GENERIC_FILE_WORDS = {
    "logo", "logos", "logotype", "wordmark", "mark", "brand", "branding", "icon", "symbol", "horizontal",
    "vertical", "full", "color", "colour", "colored", "black", "white", "dark", "light", "inverted",
    "invert", "navbar", "footer", "header", "main", "primary", "secondary", "small", "mini", "miniature",
    "large", "cmyk", "cmjn", "blanc", "noir", "webp", "jpeg", "avif", "final", "default", "site", "website",
    "retina", "transparent", "whitebg", "cropped", "scaled", "image", "images", "mask", "group", "untitled",
    "design", "copy", "tile", "version", "standard", "round", "square", "claim", "height", "width",
    "format", "trim", "resize", "thumb", "thumbnail", "upload", "uploads", "media", "file", "files",
    "favicon", "touch", "apple", "azul", "blanco", "negro", "schwarz", "weiss", "fekete", "nero", "bianco",
    "preto", "branco", "rouge", "rojo", "blue", "green", "orange", "grey", "gray", "gold", "silver",
}


def program_tokens(name: str, url: str) -> set[str]:
    """Words that mark a logo as this Program's own rather than a partner's or a portfolio company's."""
    words = {word for word in re.findall(r"[a-z0-9]+", name.lower()) if len(word) >= 4}
    host = urlparse(url).netloc.lower().removeprefix("www.").split(".")[0]
    return (words - GENERIC_NAME_WORDS) | {re.sub(r"[^a-z0-9]", "", name.lower()), re.sub(r"[^a-z0-9]", "", host)}


def names_program(hint: str, tokens: set[str]) -> bool:
    """A whole word of the hint starts with a name token, or the hint spells out the full name."""
    words = re.findall(r"[a-z0-9]+", hint.lower())
    squashed = "".join(words)
    return any(
        token and (any(word.startswith(token) for word in words) or (len(token) >= 6 and token in squashed))
        for token in tokens
    )


def file_words(url: str) -> list[str]:
    """Meaningful words of an image's file name: no hashes, sizes, colours, or layout words."""
    segments = [segment for segment in urlparse(url).path.split("/") if segment]
    named = next((segment for segment in reversed(segments) if re.search(r"\.[a-z]{3,4}$", segment, re.I)), None)
    words = [
        re.sub(r"(?<=[a-z])\d+$", "", word)
        for word in re.findall(r"[a-z0-9]+", unquote(named or (segments[-1] if segments else "")).lower())
    ]
    return [
        word
        for word in words
        if len(word) > 3
        and word not in GENERIC_FILE_WORDS
        and word not in GENERIC_NAME_WORDS
        and len(re.findall(r"\d", word)) < 3
        and not re.fullmatch(r"[0-9a-f]{8,}", word)
    ]


def names_someone_else(url: str, tokens: set[str]) -> bool:
    words = file_words(url)
    return bool(words) and not names_program(" ".join(words), tokens)


def ranked(page: Page, tokens: set[str] | None = None, marks_only: bool = False) -> list[str]:
    """Logo candidates in trust order. With tokens, only those that can be this Program's mark:
    a logo-named image outside the header, a header image found by its alt text, or a
    structured-data logo counts only when it names the Program. marks_only drops site icons."""
    ordered: list[str] = []
    for candidate in sorted(page.candidates, key=lambda item: (RANK_ORDER[item.rank], item.order)):
        named = tokens is not None and names_program(candidate.hint, tokens)
        if candidate.rank == NAMED_HEADER_IMAGE and not named:
            continue
        if candidate.rank in {BODY_LOGO, DECLARED_LOGO} and tokens is not None and not named:
            continue
        if marks_only and candidate.rank in {TOUCH_ICON, ICON}:
            continue
        ordered.append(candidate.url)
    if not marks_only:
        ordered.append(urljoin(page.base, "/favicon.ico"))
    return list(dict.fromkeys(ordered))


def is_svg(data: bytes, content_type: str, url: str) -> bool:
    if "svg" in content_type.lower() or urlparse(url).path.lower().endswith(".svg"):
        return True
    return b"<svg" in data[:2048].lower()


def rasterize_svg(data: bytes) -> bytes:
    tools = (
        ["rsvg-convert", "--width", str(LOGO_EDGE), "--keep-aspect-ratio", "--format", "png"],
        ["magick", "-background", "none", "-density", "300", "svg:-", "-resize", f"{LOGO_EDGE}x{LOGO_EDGE}", "png:-"],
    )
    for command in tools:
        if shutil.which(command[0]):
            result = subprocess.run(command, input=data, capture_output=True, timeout=60)
            if result.returncode == 0 and result.stdout:
                return result.stdout
    raise RuntimeError("SVG logos need rsvg-convert or ImageMagick on PATH")


def to_png(data: bytes, content_type: str, url: str, min_edge: int = 16) -> bytes:
    from PIL import Image

    if is_svg(data, content_type, url):
        data = rasterize_svg(data)
    image = Image.open(BytesIO(data))
    image.load()
    image = image.convert("RGBA")
    image.thumbnail((LOGO_EDGE, LOGO_EDGE))
    if min(image.size) < min_edge or image.getbbox() is None:
        raise ValueError(f"image is {image.size[0]}x{image.size[1]} or blank")
    out = BytesIO()
    image.save(out, "PNG", optimize=True)
    return out.getvalue()


def refresh_logo(fetcher: Fetcher, outcome: Outcome, html: str, page: Page, now: datetime, stamp: bool) -> None:
    """Keep the stored mark while it is on the page and is the Program's own; otherwise replace it
    with a header or named mark, using a site icon only to replace another company's logo."""
    program = outcome.program
    source = next(item for item in program["sources"] if item["id"] == "official-logo")
    local = LOGOS / Path(program["logo"]["path"]).name
    stored = source["quote"]
    on_page = bool(stored) and (stored in ranked(page) or stored in html or (urlparse(stored).path or "\0") in html)
    tokens = program_tokens(program["name"], program["websiteUrl"])
    own_marks = ranked(page, tokens, marks_only=True)
    icons = [url for url in ranked(page, tokens) if url not in own_marks]
    foreign = bool(stored) and names_someone_else(stored, tokens)
    borrowed = stored not in own_marks and (
        foreign or any(candidate.rank == BODY_LOGO and candidate.url == stored for candidate in page.candidates)
    )
    stored_icon = stored.endswith("/favicon.ico") or any(
        candidate.url == stored and candidate.rank in {TOUCH_ICON, ICON} for candidate in page.candidates
    )
    replacements = [url for url in own_marks + (icons if foreign and not stored_icon else []) if url != stored]
    if local.exists() and on_page and not (borrowed and replacements):
        if borrowed:
            outcome.suspect_logo = stored
            outcome.note("logo-suspect", f"{stored} is a page image that does not name the Program")
        if stamp:
            source["checkedAt"] = iso(now)
            outcome.stamped = True
        return
    if local.exists():
        tries = replacements if on_page else own_marks
    else:
        tries = list(dict.fromkeys(([stored] if stored else []) + ranked(page, tokens)))
    failures: list[str] = []
    for url in tries:
        try:
            response = fetcher.fetch(url, attempts=2)
            png = to_png(response.body, response.content_type, response.url, MIN_ICON_EDGE if local.exists() and url in icons else 16)
        except Exception as error:
            failures.append(f"{url}: {error}")
            continue
        target = LOGOS / f"{outcome.program_id}.png"
        outcome.logo = (target, png)
        if local != target and local.exists():
            outcome.old_logo = local
        program["logo"]["path"] = f"/accelerators/logos/{target.name}"
        source["quote"] = url
        source["checkedAt"] = iso(now)
        outcome.changed = outcome.drift = True
        outcome.note("logo", url)
        return
    reason = failures[-1] if failures else "no header mark on the page names the Program"
    if local.exists() and on_page:
        outcome.suspect_logo = stored
        outcome.note("logo-suspect", f"{stored} may not be the Program's own mark; no replacement could be downloaded ({reason})")
        return
    if local.exists():
        outcome.drift = True
        outcome.note("logo-kept", reason)
        outcome.observe(
            "official-logo",
            "stale",
            now,
            "The stored logo URL is no longer on the page and no header mark could replace it. The stored logo was kept.",
        )
        return
    outcome.note("logo-failed", reason)
    outcome.observe("official-logo", "inaccessible", now, "No mark on the page could be downloaded and rasterized.")
