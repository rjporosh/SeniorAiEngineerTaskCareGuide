import asyncio
import hmac
import logging
import os
import tempfile
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from .config import Settings, get_settings
from .errors import ProcessingError
from .models import ErrorBody, ErrorResponse, ProcessResponse
from .ocr import configure as configure_ocr
from .ocr import missing_languages, tesseract_available
from .pipeline import process_file

log = logging.getLogger("processor")
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper(), format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}')


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ANN201
    settings = get_settings()
    configure_ocr(settings)
    app.state.gate = asyncio.Semaphore(max(1, settings.processor_concurrency))
    yield


app = FastAPI(title="Document Processor (internal)", version="1.0.0", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def _error(e: ProcessingError) -> JSONResponse:
    body = ErrorResponse(error=ErrorBody(code=e.code, message=e.message, retryable=e.retryable))
    return JSONResponse(status_code=e.status, content=body.model_dump())


@app.exception_handler(ProcessingError)
async def processing_error_handler(_: Request, e: ProcessingError) -> JSONResponse:
    return _error(e)


@app.exception_handler(Exception)
async def unhandled(_: Request, e: Exception) -> JSONResponse:
    log.exception("unhandled error")
    return _error(ProcessingError("INTERNAL_ERROR", "Internal processing error.", retryable=True, status=500))


def require_service_token(authorization: str | None = Header(default=None), settings: Settings = Depends(get_settings)) -> None:
    expected = f"Bearer {settings.processor_service_token}"
    if authorization is None or not hmac.compare_digest(authorization.encode(), expected.encode()):
        raise ProcessingError("UNAUTHORIZED", "Invalid service credentials.", retryable=False, status=401)


@app.get("/health/live")
def live() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready")
def ready(settings: Settings = Depends(get_settings)) -> JSONResponse:
    engine = tesseract_available()
    missing = missing_languages(settings) if engine else []
    ok = engine and not missing
    checks = [
        {"name": "tesseract", "status": "up" if engine else "down"},
        {"name": "ocr-languages", "status": "up" if not missing else "down", "languages": settings.ocr_languages, "missing": missing},
    ]
    return JSONResponse(status_code=200 if ok else 503, content={"status": "ok" if ok else "degraded", "checks": checks})


async def _spool(request: Request, limit_bytes: int) -> Path:
    """Streams the request body to a private temp file, enforcing the size limit while reading."""
    fd, name = tempfile.mkstemp(prefix="proc-", suffix=".bin")
    path = Path(name)
    size = 0
    try:
        with os.fdopen(fd, "wb") as out:
            async for chunk in request.stream():
                size += len(chunk)
                if size > limit_bytes:
                    raise ProcessingError("FILE_TOO_LARGE", "The file exceeds the configured size limit.", status=413)
                out.write(chunk)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return path


@app.post("/internal/v1/process", response_model=ProcessResponse, dependencies=[Depends(require_service_token)])
async def process(request: Request, x_request_id: str | None = Header(default=None), settings: Settings = Depends(get_settings)) -> ProcessResponse:
    rid = x_request_id if x_request_id and len(x_request_id) <= 128 else str(uuid.uuid4())
    gate: asyncio.Semaphore = request.app.state.gate
    try:
        await asyncio.wait_for(gate.acquire(), timeout=settings.processor_queue_wait_seconds)
    except asyncio.TimeoutError:
        raise ProcessingError("BUSY", "The processor is at capacity; retry shortly.", retryable=True, status=503) from None
    path: Path | None = None
    try:
        path = await _spool(request, settings.max_file_size_mb * 1024 * 1024)
        result = await run_in_threadpool(process_file, path, settings)
        log.info("request_id=%s kind=%s pages=%d ocr_pages=%d rows=%d ms=%d", rid, result.file_kind, result.stats.pages, result.stats.ocr_pages, result.stats.rows, result.stats.duration_ms)
        return result
    except ProcessingError as e:
        cause = type(e.__cause__).__name__ if e.__cause__ else "-"
        log.warning("request_id=%s code=%s cause=%s detail=%s", rid, e.code, cause, str(e.__cause__)[:200] if e.__cause__ else "-")
        raise
    finally:
        gate.release()
        if path is not None:
            path.unlink(missing_ok=True)
