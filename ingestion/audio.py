"""Transcribe audio files using faster-whisper."""
from datetime import date
from config import WHISPER_MODEL, WHISPER_DEVICE, WHISPER_COMPUTE_TYPE


def process_audio(file_path: str) -> dict:
    """
    Args:
        file_path: Absolute path to .m4a/.mp3/.wav file
    Returns dict with: raw_content, source_type, ingest_method, duration_seconds, date_ingested
    """
    from faster_whisper import WhisperModel

    model = WhisperModel(
        WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE_TYPE
    )
    segments, info = model.transcribe(file_path, beam_size=5)
    transcript = " ".join(seg.text.strip() for seg in segments)
    duration = int(info.duration) if hasattr(info, "duration") else 0

    return {
        "raw_content": transcript,
        "source_type": "audio",
        "ingest_method": "audio-upload",
        "duration_seconds": duration,
        "date_ingested": date.today().isoformat(),
    }
