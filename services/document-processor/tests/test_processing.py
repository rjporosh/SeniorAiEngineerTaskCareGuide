import time

import pytest

from . import fixtures as fx


def norm(s: str) -> str:
    return " ".join(s.split()).lower()


def all_text(body: dict) -> str:
    return norm(" ".join(b["text"] for b in body["blocks"]))


# ---- PDFs -------------------------------------------------------------------------------------

def test_digital_pdf_uses_embedded_text_without_ocr(tmp_path, post):
    r = post(fx.digital_pdf(tmp_path / "a.pdf"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["file_kind"] == "pdf"
    assert body["stats"]["embedded_pages"] == 1 and body["stats"]["ocr_pages"] == 0
    assert "inv-2026-0042" in all_text(body)
    assert body["blocks"][0]["source"] == "embedded" and body["blocks"][0]["page"] == 1


def test_scanned_pdf_is_ocrd_with_confidence(tmp_path, post):
    r = post(fx.scanned_pdf(tmp_path / "s.pdf"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stats"]["ocr_pages"] == 1
    text = all_text(body)
    assert "acme" in text and "1100.00" in text
    assert body["blocks"][0]["source"] == "ocr" and 0 < body["blocks"][0]["confidence"] <= 1


def test_hybrid_pdf_ocrs_only_the_pages_that_need_it(tmp_path, post):
    body = post(fx.hybrid_pdf(tmp_path / "h.pdf")).json()
    assert [(b["page"], b["source"]) for b in body["blocks"]] == [(1, "embedded"), (2, "ocr")]
    assert body["stats"]["embedded_pages"] == 1 and body["stats"]["ocr_pages"] == 1


def test_pdf_page_limit_is_enforced(tmp_path, client, settings):
    from app.main import app
    from app.config import get_settings
    settings.max_pdf_pages = 5
    app.dependency_overrides[get_settings] = lambda: settings
    p = fx.many_page_pdf(tmp_path / "big.pdf", 6)
    r = client.post("/internal/v1/process", content=p.read_bytes(), headers={"Authorization": f"Bearer {settings.processor_service_token}"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "PAGE_LIMIT_EXCEEDED"
    assert r.json()["error"]["retryable"] is False


def test_encrypted_pdf_is_rejected_safely(tmp_path, post):
    r = post(fx.encrypted_pdf(tmp_path / "e.pdf"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "PDF_ENCRYPTED"


def test_large_pdf_is_processed_page_by_page_within_time(tmp_path, post):
    p = fx.many_page_pdf(tmp_path / "1000.pdf", 1000)
    t0 = time.monotonic()
    r = post(p)
    elapsed = time.monotonic() - t0
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stats"]["pages"] == 1000 and len(body["blocks"]) == 1000
    assert elapsed < 60, f"1000-page digital PDF took {elapsed:.1f}s"


# ---- Images -----------------------------------------------------------------------------------

@pytest.mark.parametrize("make,kind", [(lambda d: fx.png(d / "i.png"), "png"), (lambda d: fx.jpeg(d / "i.jpg"), "jpeg")])
def test_images_are_ocrd(tmp_path, post, make, kind):
    body = post(make(tmp_path)).json()
    assert body["file_kind"] == kind
    assert "inv-2026-0042" in all_text(body)


def test_bengali_image_is_ocrd_with_bengali_and_latin_text(tmp_path, post):
    body = post(fx.bengali_png(tmp_path / "bn.png")).json()
    text = all_text(body)
    assert "চালান" in text and "মোট" in text, text
    assert "inv-501" in text and "৫০১" in text, text  # English stays accurate alongside the Bengali model
    assert "১২০০" in text, text


def test_readiness_reports_installed_ocr_languages(client):
    body = client.get("/health/ready").json()
    assert body["status"] == "ok"
    lang = next(c for c in body["checks"] if c["name"] == "ocr-languages")
    assert lang["missing"] == [] and "ben" in lang["languages"]


def test_readiness_degrades_when_a_configured_language_is_not_installed(client, settings, monkeypatch):
    monkeypatch.setattr(settings, "ocr_languages", "eng+xxx")
    r = client.get("/health/ready")
    assert r.status_code == 503
    assert next(c for c in r.json()["checks"] if c["name"] == "ocr-languages")["missing"] == ["xxx"]


def test_skewed_image_is_deskewed_before_ocr(tmp_path, post):
    body = post(fx.png(tmp_path / "r.png", rotate=3.0)).json()
    assert "1100.00" in all_text(body)


def test_multiframe_tiff_returns_one_block_per_frame(tmp_path, post):
    body = post(fx.tiff_multiframe(tmp_path / "m.tiff")).json()
    assert body["file_kind"] == "tiff" and body["stats"]["pages"] == 2
    pages = {b["page"]: norm(b["text"]) for b in body["blocks"]}
    assert "aaa-111" in pages[1] and "bbb-222" in pages[2]


def test_corrupt_image_fails_with_safe_error(tmp_path, post):
    good = fx.png(tmp_path / "c.png")
    bad = tmp_path / "bad.png"
    bad.write_bytes(good.read_bytes()[:60])
    r = post(bad)
    assert r.status_code == 422 and r.json()["error"]["code"] == "CORRUPT_FILE"


def test_pixel_limit_blocks_decompression_bombs(tmp_path, client, settings):
    from app.main import app
    from app.config import get_settings
    settings.max_image_pixels = 100_000
    app.dependency_overrides[get_settings] = lambda: settings
    p = fx.png(tmp_path / "huge.png", size=(2000, 1000))
    r = client.post("/internal/v1/process", content=p.read_bytes(), headers={"Authorization": f"Bearer {settings.processor_service_token}"})
    assert r.status_code == 422 and r.json()["error"]["code"] in {"CORRUPT_FILE", "IMAGE_TOO_LARGE"}


# ---- Spreadsheets -----------------------------------------------------------------------------

def test_xlsx_all_sheets_with_cell_coordinates_and_no_formula_evaluation(tmp_path, post):
    body = post(fx.xlsx_multisheet(tmp_path / "b.xlsx")).json()
    assert body["file_kind"] == "xlsx" and body["stats"]["sheets"] == 2
    sheets = {b["sheet"] for b in body["blocks"]}
    assert sheets == {"Invoices", "Lines"}
    row2 = next(b for b in body["blocks"] if b["sheet"] == "Invoices" and b["range"].endswith("2"))
    assert {c["ref"]: c["value"] for c in row2["cells"]}["C2"] == "100.5"
    # formula text is never executed or surfaced as a computed value
    assert not any("HYPERLINK" in b["text"] and b["source"] != "cell" for b in body["blocks"])


def test_xls_multisheet(tmp_path, post):
    body = post(fx.xls_multisheet(tmp_path / "b.xls")).json()
    assert body["file_kind"] == "xls" and body["stats"]["sheets"] == 2
    assert any(c["ref"] == "B2" and c["value"] == "250.75" for b in body["blocks"] if b["sheet"] == "Invoices" for c in (b["cells"] or []))


def test_csv_delimiter_and_encoding_detection(tmp_path, post):
    semi = post(fx.csv_bytes(tmp_path / "s.csv", "inv;total\nINV-1;10,5\n")).json()
    assert [c["value"] for c in semi["blocks"][1]["cells"]] == ["INV-1", "10,5"]
    legacy = post(fx.csv_bytes(tmp_path / "l.csv", "name,total\ncafé,1\n", "cp1252")).json()
    assert any(w["code"] == "ENCODING_ASSUMED" for w in legacy["warnings"])
    assert "café" in all_text(legacy)


def test_csv_formula_cells_are_returned_as_inert_text(tmp_path, post):
    body = post(fx.csv_bytes(tmp_path / "f.csv", "a,b\n=cmd|' /C calc'!A0,1\n")).json()
    assert body["blocks"][1]["cells"][0]["value"].startswith("=cmd")


def test_spreadsheet_row_limit(tmp_path, client, settings):
    from app.main import app
    from app.config import get_settings
    settings.max_spreadsheet_rows = 3
    app.dependency_overrides[get_settings] = lambda: settings
    p = fx.csv_bytes(tmp_path / "r.csv", "a,b\n" + "1,2\n" * 10)
    r = client.post("/internal/v1/process", content=p.read_bytes(), headers={"Authorization": f"Bearer {settings.processor_service_token}"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "SPREADSHEET_LIMIT_EXCEEDED"


def test_zip_bomb_workbook_is_rejected_before_parsing(tmp_path, post):
    r = post(fx.zip_bomb_xlsx(tmp_path / "bomb.xlsx"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "UNSAFE_ARCHIVE"


def test_corrupt_workbook(tmp_path, post):
    p = tmp_path / "c.xlsx"
    p.write_bytes(b"PK\x03\x04" + b"garbage" * 50)
    r = post(p)
    assert r.status_code == 422 and r.json()["error"]["code"] == "CORRUPT_FILE"


# ---- Hostile / invalid input & API contract ----------------------------------------------------

def test_executable_masquerading_as_document_is_unsupported(tmp_path, post):
    p = tmp_path / "x.pdf"
    p.write_bytes(b"MZ\x90\x00\x03\x00\x00\x00" + b"\x00" * 200)
    r = post(p)
    assert r.status_code == 422 and r.json()["error"]["code"] == "UNSUPPORTED_FILE"


def test_empty_file(tmp_path, post):
    p = tmp_path / "e.pdf"
    p.write_bytes(b"")
    assert post(p).json()["error"]["code"] == "EMPTY_FILE"


def test_corrupt_pdf(tmp_path, post):
    p = tmp_path / "c.pdf"
    p.write_bytes(b"%PDF-1.7\n this is not really a pdf \x00\x01")
    assert post(p).json()["error"]["code"] == "CORRUPT_FILE"


def test_oversized_upload_is_cut_off(tmp_path, client, settings):
    from app.main import app
    from app.config import get_settings
    settings.max_file_size_mb = 1
    app.dependency_overrides[get_settings] = lambda: settings
    r = client.post("/internal/v1/process", content=b"%PDF-" + b"0" * (2 * 1024 * 1024), headers={"Authorization": f"Bearer {settings.processor_service_token}"})
    assert r.status_code == 413 and r.json()["error"]["code"] == "FILE_TOO_LARGE"


def test_service_token_is_required(tmp_path, post):
    p = fx.digital_pdf(tmp_path / "a.pdf")
    assert post(p, token=None).status_code == 401
    assert post(p, token="wrong-token-wrong-token").status_code == 401


def test_errors_never_leak_paths_or_stack_traces(tmp_path, post):
    p = tmp_path / "c.pdf"
    p.write_bytes(b"%PDF-1.7\n broken")
    text = post(p).text
    assert "Traceback" not in text and "/tmp" not in text and str(tmp_path) not in text


def test_health_endpoints(client):
    assert client.get("/health/live").json() == {"status": "ok"}
    ready = client.get("/health/ready")
    assert ready.status_code == 200 and ready.json()["checks"][0]["name"] == "tesseract"
