import logging
from fastapi import FastAPI, HTTPException

from .docling_runner import run_docling
from .fetcher import fetch_to_tempfile
from .schemas import ParseRequest, ParseResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("ocr-worker")

app = FastAPI(title="LaunchStack OCR Worker", version="0.2.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/parse/docling", response_model=ParseResponse)
def parse_docling(req: ParseRequest) -> ParseResponse:
    log.info("parse/docling url=%s mime=%s", req.url, req.mime)
    try:
        with fetch_to_tempfile(req.url, suffix=_suffix_from_filename(req.filename)) as path:
            return run_docling(path)
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("docling failed")
        raise HTTPException(status_code=500, detail=f"docling failed: {exc}") from exc


# Keep /parse/marker as an alias that routes through docling
@app.post("/parse/marker", response_model=ParseResponse)
def parse_marker(req: ParseRequest) -> ParseResponse:
    log.info("parse/marker (routed to docling) url=%s mime=%s", req.url, req.mime)
    try:
        with fetch_to_tempfile(req.url, suffix=_suffix_from_filename(req.filename)) as path:
            return run_docling(path)
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("docling (via marker route) failed")
        raise HTTPException(status_code=500, detail=f"docling failed: {exc}") from exc


def _suffix_from_filename(filename: str | None) -> str | None:
    if not filename or "." not in filename:
        return None
    return "." + filename.rsplit(".", 1)[-1].lower()
