"""On-disk HTTP cache. Conditional requests use ETag and Last-Modified.

A warm cache keeps reruns cheap. When a revalidated body has the same visible
text as the stored body, the stored body is kept so extraction stays stable.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


class HttpCache:
    def __init__(self, directory: Path) -> None:
        self.directory = directory

    def path_for(self, url: str, rendered: bool = False) -> Path:
        digest = hashlib.sha256(f"{url}|{'rendered' if rendered else 'raw'}".encode()).hexdigest()
        return self.directory / digest[:2] / digest

    def load(self, url: str, rendered: bool = False) -> dict | None:
        base = self.path_for(url, rendered)
        meta_path, body_path = base.with_suffix(".json"), base.with_suffix(".body")
        if not meta_path.exists() or not body_path.exists():
            return None
        record = json.loads(meta_path.read_text())
        record["body"] = body_path.read_bytes()
        return record

    def store(
        self,
        url: str,
        body: bytes,
        content_type: str,
        etag: str | None,
        last_modified: str | None,
        final_url: str,
        rendered: bool = False,
    ) -> None:
        base = self.path_for(url, rendered)
        base.parent.mkdir(parents=True, exist_ok=True)
        base.with_suffix(".body").write_bytes(body)
        base.with_suffix(".json").write_text(
            json.dumps(
                {
                    "url": url,
                    "final_url": final_url,
                    "content_type": content_type,
                    "etag": etag,
                    "last_modified": last_modified,
                },
                indent=2,
            )
            + "\n"
        )
