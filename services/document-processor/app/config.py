from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All limits come from the environment so they can be tuned per deployment without code changes."""

    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    processor_service_token: str = Field(min_length=16)
    max_file_size_mb: int = 50
    max_pdf_pages: int = 1000
    max_image_pixels: int = 60_000_000
    max_tiff_frames: int = 200
    max_spreadsheet_rows: int = 200_000
    max_spreadsheet_cells: int = 5_000_000
    max_spreadsheet_sheets: int = 50
    max_zip_uncompressed_mb: int = 500
    max_zip_ratio: int = 200
    max_text_chars: int = 30_000_000
    processing_timeout_seconds: int = 900
    # Tesseract language codes joined with "+"; every code must have its traineddata installed (see Dockerfile). eng+ben covers Bengali.
    ocr_languages: str = "eng+ben"
    ocr_psm: int = 6
    ocr_dpi: int = 200
    ocr_max_dimension: int = 4200
    ocr_page_timeout_seconds: int = 120
    pdf_min_embedded_chars: int = 25
    processor_concurrency: int = 2
    processor_queue_wait_seconds: int = 5
    tesseract_cmd: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
