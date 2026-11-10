"""Synthetic document builders. Nothing here is real customer data."""
import io
import zipfile
from pathlib import Path

import pymupdf
import xlwt
from openpyxl import Workbook
from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

INVOICE_LINES = [
    "ACME SUPPLIES LTD",
    "Invoice No: INV-2026-0042",
    "Invoice Date: 2026-03-15",
    "Bill To: Globex Corporation",
    "Subtotal: 1000.00",
    "Tax: 100.00",
    "Total: 1100.00 USD",
]


def text_image(lines: list[str] = INVOICE_LINES, size: tuple[int, int] = (1200, 800), font_size: int = 40, rotate: float = 0.0) -> Image.Image:
    img = Image.new("RGB", size, "white")
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, font_size)
    y = 40
    for line in lines:
        d.text((60, y), line, fill="black", font=font)
        y += font_size + 24
    return img.rotate(rotate, expand=False, fillcolor="white") if rotate else img


def digital_pdf(path: Path, pages: list[list[str]] | None = None) -> Path:
    doc = pymupdf.open()
    for lines in pages or [INVOICE_LINES]:
        page = doc.new_page()
        y = 72
        for line in lines:
            page.insert_text((72, y), line, fontsize=12)
            y += 20
    doc.save(path)
    doc.close()
    return path


def scanned_pdf(path: Path, pages: int = 1) -> Path:
    doc = pymupdf.open()
    for _ in range(pages):
        page = doc.new_page(width=595, height=842)
        buf = io.BytesIO()
        text_image(size=(1190, 1684), font_size=44).save(buf, format="PNG")
        page.insert_image(page.rect, stream=buf.getvalue())
    doc.save(path)
    doc.close()
    return path


def hybrid_pdf(path: Path) -> Path:
    doc = pymupdf.open()
    p1 = doc.new_page()
    p1.insert_text((72, 72), "This page has plenty of embedded text for extraction.", fontsize=12)
    p2 = doc.new_page(width=595, height=842)
    buf = io.BytesIO()
    text_image(size=(1190, 1684), font_size=44).save(buf, format="PNG")
    p2.insert_image(p2.rect, stream=buf.getvalue())
    doc.save(path)
    doc.close()
    return path


def many_page_pdf(path: Path, pages: int) -> Path:
    doc = pymupdf.open()
    for i in range(pages):
        doc.new_page().insert_text((72, 72), f"Page {i + 1} of synthetic load document with enough text to count.", fontsize=11)
    doc.save(path, garbage=3, deflate=True)
    doc.close()
    return path


def encrypted_pdf(path: Path) -> Path:
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 72), "secret secret secret secret secret", fontsize=12)
    doc.save(path, encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="owner", user_pw="user")
    doc.close()
    return path


def png(path: Path, **kw) -> Path:
    text_image(**kw).save(path, format="PNG")
    return path


def jpeg(path: Path) -> Path:
    text_image().save(path, format="JPEG", quality=85)
    return path


def tiff_multiframe(path: Path) -> Path:
    first = text_image(["FIRST FRAME", "Invoice No: AAA-111"])
    second = text_image(["SECOND FRAME", "Invoice No: BBB-222"])
    first.save(path, format="TIFF", save_all=True, append_images=[second])
    return path


def xlsx_multisheet(path: Path) -> Path:
    wb = Workbook()
    ws = wb.active
    ws.title = "Invoices"
    ws.append(["Invoice No", "Supplier", "Total"])
    ws.append(["INV-1", "Acme", 100.5])
    ws["D2"] = "=SUM(C2:C2)"
    ws2 = wb.create_sheet("Lines")
    ws2.append(["Item", "Qty"])
    ws2.append(["Widget", 3])
    ws2.append([])
    ws2.append(["=HYPERLINK(\"http://evil\")", 1])
    wb.save(path)
    return path


def xls_multisheet(path: Path) -> Path:
    wb = xlwt.Workbook()
    a = wb.add_sheet("Invoices")
    for c, v in enumerate(["Invoice No", "Total"]):
        a.write(0, c, v)
    a.write(1, 0, "INV-9")
    a.write(1, 1, 250.75)
    b = wb.add_sheet("Notes")
    b.write(0, 0, "second sheet")
    wb.save(str(path))
    return path


def csv_bytes(path: Path, text: str, encoding: str = "utf-8") -> Path:
    path.write_bytes(text.encode(encoding))
    return path


def zip_bomb_xlsx(path: Path) -> Path:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("xl/workbook.xml", "<workbook/>")
        z.writestr("xl/bomb.xml", b"0" * (300 * 1024 * 1024))
    return path
