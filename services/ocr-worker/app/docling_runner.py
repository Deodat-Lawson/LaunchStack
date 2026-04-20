"""
Calls docling-serve's REST API instead of importing docling locally.
Expects DOCLING_SERVE_URL env var (default: http://docling-serve:5001).
"""

import os
import re
import time
from pathlib import Path
from typing import List

import httpx

from .schemas import PageContent, ExtractedTable, ParseMetadata, ParseResponse

DOCLING_SERVE_URL = os.getenv("DOCLING_SERVE_URL", "http://docling-serve:5001")
TIMEOUT_S = int(os.getenv("DOCLING_SERVE_TIMEOUT", "600"))


def run_docling(file_path: Path) -> ParseResponse:
    start = time.monotonic()

    with open(file_path, "rb") as f:
        resp = httpx.post(
            f"{DOCLING_SERVE_URL}/v1/convert/file",
            files={"files": (file_path.name, f)},
            data={
                "to_formats": '["md"]',
                "do_ocr": "true",
                "do_table_structure": "true",
                "image_export_mode": "placeholder",
            },
            timeout=TIMEOUT_S,
        )
    resp.raise_for_status()
    result = resp.json()

    document = result.get("document", result)
    md_content = document.get("md_content", "") or ""

    pages = _split_markdown_to_pages(md_content)

    elapsed_ms = int((time.monotonic() - start) * 1000)
    return ParseResponse(
        pages=pages,
        metadata=ParseMetadata(
            totalPages=len(pages),
            provider="DOCLING",
            processingTimeMs=elapsed_ms,
            confidenceScore=92.0,
        ),
    )


_PAGE_BREAK = re.compile(r"\n---\n|\n<!-- page break -->\n|\n\f", re.IGNORECASE)


def _split_markdown_to_pages(md: str) -> List[PageContent]:
    """Split docling-serve markdown output into pages."""
    if not md.strip():
        return [PageContent(pageNumber=1, textBlocks=[], tables=[])]

    chunks = _PAGE_BREAK.split(md)
    if not chunks:
        chunks = [md]

    pages: List[PageContent] = []
    for idx, chunk in enumerate(chunks, start=1):
        text = chunk.strip()
        pages.append(
            PageContent(
                pageNumber=idx,
                textBlocks=[text] if text else [],
                tables=_extract_tables(text),
            )
        )
    return pages


def _extract_tables(md: str) -> List[ExtractedTable]:
    """Parse pipe-style markdown tables."""
    tables: List[ExtractedTable] = []
    block: List[str] = []
    for line in md.splitlines():
        stripped = line.strip()
        if stripped.startswith("|") and stripped.endswith("|"):
            block.append(line)
        elif block:
            tables.append(_md_block_to_table(block))
            block = []
    if block:
        tables.append(_md_block_to_table(block))
    return [t for t in tables if t.rowCount > 0]


def _md_block_to_table(lines: List[str]) -> ExtractedTable:
    rows: List[List[str]] = []
    for line in lines:
        if re.match(r"^\s*\|?\s*[-:\s|]+\|?\s*$", line):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        rows.append(cells)
    col_count = max((len(r) for r in rows), default=0)
    return ExtractedTable(
        rows=rows,
        markdown="\n".join(lines),
        rowCount=len(rows),
        columnCount=col_count,
    )
