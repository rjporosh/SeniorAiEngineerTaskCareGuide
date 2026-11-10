from pathlib import Path

import pymupdf
from PIL import Image

from .common import Deadline, TextBudget
from .config import Settings
from .errors import ProcessingError
from .models import Block, Stats, Warning
from .ocr import ocr_image


def read_pdf(path: Path, settings: Settings, deadline: Deadline, budget: TextBudget) -> tuple[list[Block], list[Warning], Stats]:
    """Page-by-page: embedded text first, OCR only for pages without enough text. One page image in memory at a time."""
    try:
        doc = pymupdf.open(path)
    except Exception as e:  # noqa: BLE001
        raise ProcessingError("CORRUPT_FILE", "The PDF could not be opened; it may be corrupt.") from e
    with doc:
        if doc.needs_pass or doc.is_encrypted:
            raise ProcessingError("PDF_ENCRYPTED", "Password-protected PDFs are not supported.")
        pages = doc.page_count
        if pages == 0:
            raise ProcessingError("CORRUPT_FILE", "The PDF has no pages.")
        if pages > settings.max_pdf_pages:
            raise ProcessingError("PAGE_LIMIT_EXCEEDED", f"The PDF has {pages} pages; the limit is {settings.max_pdf_pages}.")
        blocks: list[Block] = []
        warnings: list[Warning] = []
        stats = Stats(pages=pages)
        for index in range(pages):
            deadline.check()
            number = index + 1
            try:
                page = doc.load_page(index)
                text = page.get_text("text").strip()
                if len(text) >= settings.pdf_min_embedded_chars:
                    budget.spend(len(text))
                    blocks.append(Block(id=f"p{number}", kind="text", page=number, text=text, source="embedded"))
                    stats.embedded_pages += 1
                    continue
                img = _render(page, settings)
            except ProcessingError:
                raise
            except Exception as e:  # noqa: BLE001
                warnings.append(Warning(code="PAGE_UNREADABLE", message=f"Page {number} could not be read: {type(e).__name__}", page=number))
                continue
            ocr_text, conf = ocr_image(img, settings)
            img.close()
            if not ocr_text.strip():
                warnings.append(Warning(code="PAGE_EMPTY", message=f"No text found on page {number}.", page=number))
                continue
            budget.spend(len(ocr_text))
            stats.ocr_pages += 1
            blocks.append(Block(id=f"p{number}", kind="text", page=number, text=ocr_text, source="ocr", confidence=conf))
            if conf is not None and conf < 0.6:
                warnings.append(Warning(code="LOW_OCR_CONFIDENCE", message=f"Page {number} OCR confidence is low ({conf:.2f}).", page=number))
        return blocks, warnings, stats


def _render(page: pymupdf.Page, settings: Settings) -> Image.Image:
    """Renders at the configured DPI, scaled down so very large pages cannot exhaust memory."""
    rect = page.rect
    scale = settings.ocr_dpi / 72.0
    longest = max(rect.width, rect.height) * scale
    if longest > settings.ocr_max_dimension:
        scale *= settings.ocr_max_dimension / longest
    pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csGRAY, alpha=False)
    return Image.frombytes("L", (pix.width, pix.height), pix.samples)
