from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

from .common import Deadline, TextBudget
from .config import Settings
from .errors import ProcessingError
from .models import Block, Stats, Warning
from .ocr import ocr_image


def read_image(path: Path, kind: str, settings: Settings, deadline: Deadline, budget: TextBudget) -> tuple[list[Block], list[Warning], Stats]:
    """OCR for JPEG/PNG and every frame of a (multi-frame) TIFF, bounded by pixel and frame limits."""
    Image.MAX_IMAGE_PIXELS = settings.max_image_pixels
    try:
        img = Image.open(path)
        img.verify()  # cheap structural check
        img = Image.open(path)
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError) as e:
        raise ProcessingError("CORRUPT_FILE", "The image could not be decoded; it may be corrupt or too large.") from e
    frames = getattr(img, "n_frames", 1)
    if frames > settings.max_tiff_frames:
        raise ProcessingError("PAGE_LIMIT_EXCEEDED", f"The image has {frames} frames; the limit is {settings.max_tiff_frames}.")
    if img.width * img.height > settings.max_image_pixels:
        raise ProcessingError("IMAGE_TOO_LARGE", "The image dimensions exceed the configured limit.")
    blocks: list[Block] = []
    warnings: list[Warning] = []
    stats = Stats(pages=frames)
    for index in range(frames):
        deadline.check()
        number = index + 1
        try:
            img.seek(index)
            frame = ImageOps.exif_transpose(img.copy())
            text, conf = ocr_image(frame, settings)
            frame.close()
        except (OSError, Image.DecompressionBombError, ValueError) as e:
            warnings.append(Warning(code="PAGE_UNREADABLE", message=f"Frame {number} could not be decoded.", page=number))
            if frames == 1:
                raise ProcessingError("CORRUPT_FILE", "The image could not be decoded.") from e
            continue
        if not text.strip():
            warnings.append(Warning(code="PAGE_EMPTY", message=f"No text found in frame {number}.", page=number))
            continue
        budget.spend(len(text))
        stats.ocr_pages += 1
        blocks.append(Block(id=f"p{number}", kind="text", page=number, text=text, source="ocr", confidence=conf))
        if conf is not None and conf < 0.6:
            warnings.append(Warning(code="LOW_OCR_CONFIDENCE", message=f"Frame {number} OCR confidence is low ({conf:.2f}).", page=number))
    return blocks, warnings, stats
