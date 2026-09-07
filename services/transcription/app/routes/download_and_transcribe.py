"""
POST /download-and-transcribe — Download audio from a video URL and transcribe it.
Uses yt-dlp to extract audio from YouTube and other video platforms,
then transcribes via the local Whisper model.

Wire format frozen:
- packages/schema-generator/schemas/v1/transcription.video-request.schema.json
- packages/schema-generator/schemas/v1/transcription.video-response.schema.json
"""

import os
import tempfile
import logging
from pathlib import Path

import yt_dlp
from fastapi import APIRouter, Depends, Request, HTTPException
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.auth import verify_api_key
from app.url_policy import validate_download_url

logger = logging.getLogger(__name__)
# Authenticated at the router level. This endpoint takes an arbitrary URL and
# fetches it with yt-dlp, so leaving it open makes the service an open proxy.
router = APIRouter(dependencies=[Depends(verify_api_key)])


class VideoTranscribeRequest(BaseModel):
    url: str
    # Max duration in seconds to download (0 = no limit).
    # Prevents accidentally downloading multi-hour streams.
    max_duration: int = 7200


class VideoTranscribeResponse(BaseModel):
    text: str
    language: str
    confidence: float
    title: str
    duration: float | None
    source_url: str


def _download_audio(url: str, output_dir: str, max_duration: int) -> dict:
    """
    Download audio from a video URL using yt-dlp.

    Returns a dict with 'filepath', 'title', and 'duration'.
    """
    output_template = os.path.join(output_dir, "%(id)s.%(ext)s")

    ydl_opts: dict = {
        "format": "bestaudio/best",
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }
        ],
        "outtmpl": output_template,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
    }

    if max_duration > 0:
        ydl_opts["match_filter"] = yt_dlp.utils.match_filter_func(
            f"duration <= {max_duration}"
        )

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        if info is None:
            raise ValueError("yt-dlp returned no info for this URL")

        video_id = info.get("id", "audio")
        title = info.get("title", "Unknown")
        duration = info.get("duration")

        # yt-dlp post-processor changes extension to mp3
        filepath = os.path.join(output_dir, f"{video_id}.mp3")
        if not os.path.exists(filepath):
            # Fallback: find whatever file was downloaded
            files = list(Path(output_dir).glob(f"{video_id}.*"))
            if not files:
                raise FileNotFoundError(
                    "yt-dlp did not produce an output file"
                )
            filepath = str(files[0])

        return {
            "filepath": filepath,
            "title": title,
            "duration": duration,
        }


@router.post(
    "/download-and-transcribe", response_model=VideoTranscribeResponse
)
async def download_and_transcribe(
    body: VideoTranscribeRequest, request: Request
):
    """
    Download audio from a video URL, transcribe it with Whisper,
    and return the transcript with metadata.

    Supported platforms: YouTube, Vimeo, Twitter/X, TikTok — subject to the
    TRANSCRIPTION_ALLOWED_HOSTS allowlist (ADR-004 §6).
    """
    url = body.url
    # Policy check BEFORE yt-dlp sees the URL: http(s) only, no IP literals,
    # no localhost, host must match the configured allowlist (403 otherwise).
    validate_download_url(url, request.app.state.config.allowed_hosts)
    logger.info(f"[DownloadTranscribe] Starting: {url}")

    with tempfile.TemporaryDirectory(prefix="ytdl_") as tmp_dir:
        # 1. Download audio. yt-dlp is blocking (network + ffmpeg) — run it in
        # the threadpool so the event loop (and /health) stays responsive.
        try:
            dl_result = await run_in_threadpool(
                _download_audio, url, tmp_dir, body.max_duration
            )
        except HTTPException:
            raise
        except yt_dlp.utils.DownloadError as e:
            logger.error(f"[DownloadTranscribe] Download failed: {e}")
            raise HTTPException(
                status_code=422,
                detail=f"Could not download audio from URL: {e}",
            )
        except Exception as e:
            logger.error(f"[DownloadTranscribe] Download error: {e}")
            raise HTTPException(
                status_code=500, detail=f"Download failed: {e}"
            )

        logger.info(
            f"[DownloadTranscribe] Downloaded: {dl_result['title']} "
            f"({dl_result['duration']}s) → {dl_result['filepath']}"
        )

        # 2. Transcribe (also blocking — same threadpool treatment).
        try:
            transcriber = request.app.state.transcriber
            result = await run_in_threadpool(
                transcriber.transcribe, dl_result["filepath"]
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"[DownloadTranscribe] Transcription error: {e}")
            raise HTTPException(
                status_code=500, detail=f"Transcription failed: {e}"
            )

    logger.info(
        f"[DownloadTranscribe] Complete: {dl_result['title']} → "
        f"{len(result['text'])} chars, lang={result['language']}"
    )

    return VideoTranscribeResponse(
        text=result["text"],
        language=result["language"],
        confidence=result["confidence"],
        title=dl_result["title"],
        duration=dl_result["duration"],
        source_url=url,
    )
