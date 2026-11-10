import time

from .errors import ProcessingError


class Deadline:
    """Cooperative timeout checked between pages / rows so a hostile file cannot pin a worker forever."""

    def __init__(self, seconds: int) -> None:
        self._end = time.monotonic() + seconds
        self.started = time.monotonic()

    def check(self) -> None:
        if time.monotonic() > self._end:
            raise ProcessingError("PROCESSING_TIMEOUT", "Processing exceeded the time limit.", retryable=False, status=422)

    def elapsed_ms(self) -> int:
        return int((time.monotonic() - self.started) * 1000)

    def remaining(self) -> float:
        return max(0.0, self._end - time.monotonic())


class TextBudget:
    """Bounds the total amount of text returned to the caller."""

    def __init__(self, limit: int) -> None:
        self._left = limit

    def spend(self, n: int) -> None:
        self._left -= n
        if self._left < 0:
            raise ProcessingError("TEXT_LIMIT_EXCEEDED", "The extracted text exceeds the configured limit.")
