from pathlib import Path

from .common import Deadline, TextBudget
from .config import Settings
from .detect import sniff
from .errors import ProcessingError
from .image_reader import read_image
from .models import ProcessResponse
from .pdf_reader import read_pdf
from .spreadsheet_reader import read_csv, read_xls, read_xlsx


def process_file(path: Path, settings: Settings) -> ProcessResponse:
    """Dispatches to the format-specific bounded reader based on the real content type."""
    deadline = Deadline(settings.processing_timeout_seconds)
    budget = TextBudget(settings.max_text_chars)
    kind = sniff(path)
    if kind == "pdf":
        blocks, warnings, stats = read_pdf(path, settings, deadline, budget)
    elif kind in ("jpeg", "png", "tiff"):
        blocks, warnings, stats = read_image(path, kind, settings, deadline, budget)
    elif kind == "xlsx":
        blocks, warnings, stats = read_xlsx(path, settings, deadline, budget)
    elif kind == "xls":
        blocks, warnings, stats = read_xls(path, settings, deadline, budget)
    elif kind == "csv":
        blocks, warnings, stats = read_csv(path, settings, deadline, budget)
    else:  # pragma: no cover - sniff() only returns the kinds above
        raise ProcessingError("UNSUPPORTED_FILE", "The file type is not supported.")
    stats.duration_ms = deadline.elapsed_ms()
    return ProcessResponse(file_kind=kind, blocks=blocks, warnings=warnings, stats=stats)  # type: ignore[arg-type]
