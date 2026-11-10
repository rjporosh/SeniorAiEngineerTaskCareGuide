class ProcessingError(Exception):
    """A failure with a stable code. `retryable` tells the caller whether trying again can help."""

    def __init__(self, code: str, message: str, *, retryable: bool = False, status: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable
        self.status = status
