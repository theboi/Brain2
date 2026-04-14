"""Scrape article URLs using trafilatura."""
from datetime import date


class ArticleScrapeError(Exception):
    pass


def process_article(url: str) -> dict:
    """
    Returns dict with: raw_content, source_type, ingest_method, source_url, title, date_ingested
    Raises ArticleScrapeError if scraping fails (paywall, JS-heavy, timeout).
    """
    try:
        import trafilatura
    except ImportError:
        raise ArticleScrapeError("trafilatura not installed: pip install trafilatura")

    downloaded = trafilatura.fetch_url(url)
    if not downloaded:
        raise ArticleScrapeError(f"Could not fetch URL: {url}")

    result = trafilatura.extract(
        downloaded,
        include_comments=False,
        include_tables=True,
        output_format="txt",
        with_metadata=True,
    )
    if not result:
        raise ArticleScrapeError(f"Could not extract content from: {url} (paywall or JS-heavy)")

    meta = trafilatura.extract_metadata(downloaded)
    title = meta.title if meta and meta.title else url

    return {
        "raw_content": result,
        "source_type": "article",
        "ingest_method": "article-scrape",
        "source_url": url,
        "title": title,
        "date_ingested": date.today().isoformat(),
    }
