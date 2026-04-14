"""Handle pasted text input from Telegram."""
from datetime import date


def process_text(text: str) -> dict:
    """
    Args:
        text: Raw pasted text
    Returns:
        dict with keys: raw_content, source_type, ingest_method, date_ingested
    """
    return {
        "raw_content": text.strip(),
        "source_type": "text",
        "ingest_method": "pasted",
        "date_ingested": date.today().isoformat(),
    }
