import threading

import cv2
import numpy as np
import pytesseract
from PIL import Image

from .config import Settings
from .errors import ProcessingError

# Tesseract is memory hungry; cap concurrent OCR calls process-wide regardless of request concurrency.
_OCR_GATE = threading.BoundedSemaphore(2)


def configure(settings: Settings) -> None:
    global _OCR_GATE
    if settings.tesseract_cmd:
        pytesseract.pytesseract.tesseract_cmd = settings.tesseract_cmd
    _OCR_GATE = threading.BoundedSemaphore(max(1, settings.processor_concurrency))


def tesseract_available() -> bool:
    try:
        pytesseract.get_tesseract_version()
        return True
    except Exception:  # noqa: BLE001 - any failure means "not ready"
        return False


def missing_languages(settings: Settings) -> list[str]:
    """Configured OCR languages whose traineddata is not installed (empty when all are available)."""
    try:
        installed = set(pytesseract.get_languages(config=""))
    except Exception:  # noqa: BLE001 - treated as "tesseract not ready" by the caller
        return settings.ocr_languages.split("+")
    return [lang for lang in settings.ocr_languages.split("+") if lang not in installed]


def preprocess(img: Image.Image) -> np.ndarray:
    """Grayscale -> upscale small scans -> local contrast (CLAHE) -> light denoise -> deskew."""
    gray = np.array(img.convert("L"))
    h, w = gray.shape
    if max(h, w) < 1600:
        gray = cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    gray = cv2.medianBlur(gray, 3)
    return _deskew(gray)


def _deskew(gray: np.ndarray) -> np.ndarray:
    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    coords = np.column_stack(np.where(bw > 0))
    if len(coords) < 200:
        return gray
    angle = cv2.minAreaRect(coords.astype(np.float32))[-1]
    angle = angle - 90 if angle > 45 else angle
    if abs(angle) < 0.3 or abs(angle) > 15:
        return gray
    h, w = gray.shape
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(gray, m, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def ocr_image(img: Image.Image, settings: Settings) -> tuple[str, float | None]:
    """Returns (text, mean word confidence 0..1 or None when the engine reports none)."""
    arr = preprocess(img)
    config = f"--oem 1 --psm {settings.ocr_psm}"
    with _OCR_GATE:
        try:
            data = pytesseract.image_to_data(
                arr, lang=settings.ocr_languages, config=config,
                output_type=pytesseract.Output.DICT, timeout=settings.ocr_page_timeout_seconds,
            )
        except RuntimeError as e:  # pytesseract raises RuntimeError on timeout
            raise ProcessingError("OCR_TIMEOUT", "OCR timed out on a page.", retryable=False) from e
        except pytesseract.TesseractError as e:
            raise ProcessingError("OCR_FAILED", "The OCR engine failed on a page.", retryable=True, status=503) from e
    lines: dict[tuple[int, int, int], list[str]] = {}
    confs: list[float] = []
    for i, word in enumerate(data["text"]):
        word = word.strip()
        if not word:
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        lines.setdefault(key, []).append(word)
        c = float(data["conf"][i])
        if c >= 0:
            confs.append(c / 100.0)
    text = "\n".join(" ".join(ws) for _, ws in sorted(lines.items()))
    return text, (round(sum(confs) / len(confs), 4) if confs else None)
