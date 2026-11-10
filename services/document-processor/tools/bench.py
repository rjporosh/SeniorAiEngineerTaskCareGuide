"""Processor benchmark: throughput and peak memory for large and scanned documents (no network, no API)."""
import resource
import sys
import tempfile
import time
from pathlib import Path

from app.config import Settings
from app.ocr import configure
from app.pipeline import process_file
from tests import fixtures as fx


def rss_mb() -> float:
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return peak / (1024 * 1024) if sys.platform == "darwin" else peak / 1024


def run(label: str, path: Path, settings: Settings) -> None:
    before = rss_mb()
    t0 = time.monotonic()
    r = process_file(path, settings)
    dt = time.monotonic() - t0
    pages = r.stats.pages or r.stats.rows
    print(f"| {label} | {path.stat().st_size / 1024:.0f} KB | {pages} | {r.stats.ocr_pages} | {dt:.1f} s | {pages / dt:.1f}/s | {rss_mb():.0f} MB (+{rss_mb() - before:.0f}) |")


if __name__ == "__main__":
    s = Settings()  # type: ignore[call-arg]
    configure(s)
    d = Path(tempfile.mkdtemp())
    print("| Case | File | Pages/rows | OCR pages | Time | Throughput | Peak RSS (growth) |")
    print("|---|---|---|---|---|---|---|")
    run("Digital PDF, 1,000 pages", fx.many_page_pdf(d / "1000.pdf", 1000), s)
    run("Scanned PDF, 20 pages (OCR)", fx.scanned_pdf(d / "s20.pdf", 20), s)
    run("Scanned PDF, 100 pages (OCR)", fx.scanned_pdf(d / "s100.pdf", 100), s)
    run("Multi-frame TIFF, 2 frames", fx.tiff_multiframe(d / "m.tiff"), s)
    (d / "big.csv").write_text("Invoice No,Supplier,Total\n" + "".join(f"INV-{i},Supplier {i % 50},{i % 997}.50\n" for i in range(150_000)))
    run("CSV, 150,000 rows", d / "big.csv", s)
