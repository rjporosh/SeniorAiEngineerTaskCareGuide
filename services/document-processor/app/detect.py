from pathlib import Path

from .errors import ProcessingError

_SIGS: list[tuple[str, bytes]] = [
    ("jpeg", b"\xff\xd8\xff"),
    ("png", b"\x89PNG\r\n\x1a\n"),
    ("tiff", b"II*\x00"),
    ("tiff", b"MM\x00*"),
    ("xls", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"),
    ("zip", b"PK\x03\x04"),
]


def sniff(path: Path) -> str:
    """Determines the real type from content only; names and headers from callers are never trusted."""
    with path.open("rb") as f:
        head = f.read(4096)
    if not head:
        raise ProcessingError("EMPTY_FILE", "The file is empty.")
    if b"%PDF-" in head[:1024]:
        return "pdf"
    for kind, sig in _SIGS:
        if head.startswith(sig):
            return "xlsx" if kind == "zip" else kind
    if b"\x00" not in head:
        return "csv"
    raise ProcessingError("UNSUPPORTED_FILE", "The file type is not supported.")
