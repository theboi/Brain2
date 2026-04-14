"""Extract text from PDFs using pdfplumber, with pytesseract OCR fallback for scanned pages."""
from datetime import date


class PDFExtractionError(Exception):
    pass


def process_pdf(file_path: str) -> dict:
    """
    Returns dict with: raw_content, source_type, ingest_method, page_count, ocr_used, date_ingested
    Raises PDFExtractionError if no text extracted at all.
    """
    try:
        import pdfplumber
    except ImportError:
        raise PDFExtractionError("pdfplumber not installed: pip install pdfplumber")

    pages_text = []
    page_count = 0
    ocr_used = False

    with pdfplumber.open(file_path) as pdf:
        page_count = len(pdf.pages)
        for page in pdf.pages:
            text = page.extract_text()
            if text and text.strip():
                pages_text.append(text.strip())
            else:
                ocr_used = True
                try:
                    import pytesseract

                    img = page.to_image(resolution=200).original
                    ocr_text = pytesseract.image_to_string(img)
                    if ocr_text.strip():
                        pages_text.append(ocr_text.strip())
                except Exception as e:
                    pages_text.append(f"[OCR failed on page {page.page_number}: {e}]")

    if not pages_text:
        raise PDFExtractionError(f"No text could be extracted from {file_path}")

    return {
        "raw_content": "\n\n".join(pages_text),
        "source_type": "pdf",
        "ingest_method": "pdf-upload",
        "page_count": page_count,
        "ocr_used": ocr_used,
        "date_ingested": date.today().isoformat(),
    }
