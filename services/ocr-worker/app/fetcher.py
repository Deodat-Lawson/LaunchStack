import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

import httpx


@contextmanager
def fetch_to_tempfile(url: str, suffix: Optional[str] = None) -> Iterator[Path]:
    """Stream a remote file to a tempfile. Caller gets a Path; file is deleted on exit."""
    with httpx.stream("GET", url, follow_redirects=True, timeout=120.0) as r:
        r.raise_for_status()
        tmp = tempfile.NamedTemporaryFile(
            delete=False, suffix=suffix or _guess_suffix(url, r.headers.get("content-type"))
        )
        try:
            for chunk in r.iter_bytes():
                tmp.write(chunk)
            tmp.flush()
            tmp.close()
            yield Path(tmp.name)
        finally:
            Path(tmp.name).unlink(missing_ok=True)


def _guess_suffix(url: str, content_type: Optional[str]) -> str:
    stem = url.split("?")[0].rsplit("/", 1)[-1]
    if "." in stem:
        return "." + stem.rsplit(".", 1)[-1]
    if content_type:
        if "pdf" in content_type:
            return ".pdf"
        if "word" in content_type or "officedocument.wordprocessingml" in content_type:
            return ".docx"
        if "powerpoint" in content_type or "presentationml" in content_type:
            return ".pptx"
        if "spreadsheet" in content_type or "excel" in content_type:
            return ".xlsx"
        if "html" in content_type:
            return ".html"
        if "png" in content_type:
            return ".png"
        if "jpeg" in content_type or "jpg" in content_type:
            return ".jpg"
    return ".bin"
