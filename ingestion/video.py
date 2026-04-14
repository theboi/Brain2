"""Download + transcribe video URLs using yt-dlp and faster-whisper."""
import os
import subprocess
import tempfile
import logging
from datetime import date
from config import YTDLP_RETRY_BACKOFFS, WHISPER_MODEL, WHISPER_DEVICE, WHISPER_COMPUTE_TYPE

logger = logging.getLogger(__name__)


class VideoDownloadError(Exception):
    """Raised when all retry attempts are exhausted."""

    pass


def _download_audio(url: str, output_dir: str) -> str:
    """Download audio track via yt-dlp. Returns path to mp3 file. Raises RuntimeError on failure."""
    output_template = os.path.join(output_dir, "%(id)s.%(ext)s")
    result = subprocess.run(
        [
            "yt-dlp",
            "--no-playlist",
            "-x",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "0",
            "-o",
            output_template,
            url,
        ],
        capture_output=True,
        text=True,
        timeout=300,
    )
    if result.returncode != 0:
        raise RuntimeError(f"yt-dlp failed: {result.stderr[:500]}")
    for f in os.listdir(output_dir):
        if f.endswith(".mp3"):
            return os.path.join(output_dir, f)
    raise RuntimeError("yt-dlp succeeded but no mp3 found")


def process_video(url: str, attempt: int = 0) -> dict:
    """
    Download and transcribe a video URL.

    Args:
        url: Video URL
        attempt: Current retry attempt (0-indexed). Caller increments between retries.

    Returns dict with: raw_content, source_type, ingest_method, source_url, duration_seconds, date_ingested

    Raises:
        VideoDownloadError: when attempt >= len(YTDLP_RETRY_BACKOFFS) (all retries exhausted)
        RuntimeError: on download failure (caller should retry)
    """
    if attempt >= len(YTDLP_RETRY_BACKOFFS):
        raise VideoDownloadError(f"All download attempts exhausted for {url}")

    from faster_whisper import WhisperModel

    with tempfile.TemporaryDirectory() as tmpdir:
        audio_path = _download_audio(url, tmpdir)
        model = WhisperModel(
            WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE_TYPE
        )
        segments, info = model.transcribe(audio_path, beam_size=5)
        transcript = " ".join(seg.text.strip() for seg in segments)
        duration = int(info.duration) if hasattr(info, "duration") else 0

    return {
        "raw_content": transcript,
        "source_type": "video",
        "ingest_method": "yt-dlp",
        "source_url": url,
        "duration_seconds": duration,
        "date_ingested": date.today().isoformat(),
    }
