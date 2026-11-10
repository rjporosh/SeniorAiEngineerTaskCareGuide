from typing import Literal

from pydantic import BaseModel


class Cell(BaseModel):
    ref: str
    value: str


class Block(BaseModel):
    id: str
    kind: Literal["text", "row"]
    page: int | None = None
    sheet: str | None = None
    range: str | None = None
    text: str
    source: Literal["embedded", "ocr", "cell"]
    confidence: float | None = None
    cells: list[Cell] | None = None


class Warning(BaseModel):
    code: str
    message: str
    page: int | None = None


class Stats(BaseModel):
    pages: int = 0
    embedded_pages: int = 0
    ocr_pages: int = 0
    sheets: int = 0
    rows: int = 0
    duration_ms: int = 0


class ProcessResponse(BaseModel):
    file_kind: Literal["pdf", "jpeg", "png", "tiff", "xlsx", "xls", "csv"]
    blocks: list[Block]
    warnings: list[Warning]
    stats: Stats


class ErrorBody(BaseModel):
    code: str
    message: str
    retryable: bool


class ErrorResponse(BaseModel):
    error: ErrorBody
