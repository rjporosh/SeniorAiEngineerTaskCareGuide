import csv
import io
import zipfile
from pathlib import Path

import openpyxl
import xlrd
from openpyxl.utils import get_column_letter

from .common import Deadline, TextBudget
from .config import Settings
from .errors import ProcessingError
from .models import Block, Cell, Stats, Warning


def _row_block(sheet: str | None, row_no: int, values: list[tuple[int, str]], n: int) -> Block:
    first, last = values[0][0], values[-1][0]
    rng = f"{get_column_letter(first)}{row_no}:{get_column_letter(last)}{row_no}"
    cells = [Cell(ref=f"{get_column_letter(c)}{row_no}", value=v) for c, v in values]
    return Block(id=f"r{n}", kind="row", sheet=sheet, range=rng, text=" | ".join(v for _, v in values), source="cell", cells=cells)


def _text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        return repr(int(value)) if value.is_integer() and abs(value) < 1e15 else repr(value)
    if hasattr(value, "isoformat"):
        return value.isoformat()  # type: ignore[no-any-return]
    return str(value).strip()


class _Limits:
    def __init__(self, settings: Settings, deadline: Deadline, budget: TextBudget) -> None:
        self.s, self.deadline, self.budget = settings, deadline, budget
        self.rows = 0
        self.cells = 0

    def row(self, text: str, n_cells: int) -> None:
        self.rows += 1
        self.cells += n_cells
        if self.rows > self.s.max_spreadsheet_rows:
            raise ProcessingError("SPREADSHEET_LIMIT_EXCEEDED", f"The workbook has more than {self.s.max_spreadsheet_rows} rows.")
        if self.cells > self.s.max_spreadsheet_cells:
            raise ProcessingError("SPREADSHEET_LIMIT_EXCEEDED", "The workbook has too many cells.")
        if self.rows % 500 == 0:
            self.deadline.check()
        self.budget.spend(len(text))


def _guard_zip(path: Path, settings: Settings) -> None:
    """Zip-bomb and structure checks before any XML is parsed."""
    try:
        with zipfile.ZipFile(path) as z:
            infos = z.infolist()
            if len(infos) > 10_000:
                raise ProcessingError("UNSAFE_ARCHIVE", "The workbook contains too many parts.")
            total = sum(i.file_size for i in infos)
            if total > settings.max_zip_uncompressed_mb * 1024 * 1024:
                raise ProcessingError("UNSAFE_ARCHIVE", "The workbook expands beyond the allowed size.")
            for i in infos:
                if i.compress_size > 0 and i.file_size / i.compress_size > settings.max_zip_ratio and i.file_size > 1_000_000:
                    raise ProcessingError("UNSAFE_ARCHIVE", "The workbook has a suspicious compression ratio.")
                if i.filename.startswith("/") or ".." in Path(i.filename).parts:
                    raise ProcessingError("UNSAFE_ARCHIVE", "The workbook contains unsafe paths.")
            if "[Content_Types].xml" not in z.namelist() or not any(n.startswith("xl/") for n in z.namelist()):
                raise ProcessingError("CORRUPT_FILE", "The file is not a valid XLSX workbook.")
    except zipfile.BadZipFile as e:
        raise ProcessingError("CORRUPT_FILE", "The workbook is corrupt.") from e


def read_xlsx(path: Path, settings: Settings, deadline: Deadline, budget: TextBudget) -> tuple[list[Block], list[Warning], Stats]:
    _guard_zip(path, settings)
    warnings: list[Warning] = []
    with zipfile.ZipFile(path) as z:
        if any(n.lower().endswith("vbaproject.bin") for n in z.namelist()):
            warnings.append(Warning(code="MACROS_IGNORED", message="The workbook contains macros; they were not executed."))
    try:
        # In-memory buffer (bounded by the upload limit): openpyxl validates the file *name* extension,
        # and the spool file is intentionally anonymous.
        wb = openpyxl.load_workbook(io.BytesIO(path.read_bytes()), read_only=True, data_only=True)  # cached values only; formulas never evaluated
        try:
            return _read_workbook(wb, settings, deadline, budget, warnings)
        finally:
            wb.close()
    except ProcessingError:
        raise
    except Exception as e:  # noqa: BLE001
        raise ProcessingError("CORRUPT_FILE", "The workbook could not be parsed.") from e


def _read_workbook(wb: "openpyxl.Workbook", settings: Settings, deadline: Deadline, budget: TextBudget, warnings: list[Warning]) -> tuple[list[Block], list[Warning], Stats]:
    if len(wb.sheetnames) > settings.max_spreadsheet_sheets:
        raise ProcessingError("SPREADSHEET_LIMIT_EXCEEDED", "The workbook has too many sheets.")
    limits = _Limits(settings, deadline, budget)
    blocks: list[Block] = []
    for name in wb.sheetnames:
        ws = wb[name]
        for row_no, row in enumerate(ws.iter_rows(values_only=True), start=1):
            values = [(c, t) for c, v in enumerate(row, start=1) if (t := _text(v))]
            if not values:
                continue
            block = _row_block(name, row_no, values, len(blocks) + 1)
            limits.row(block.text, len(values))
            blocks.append(block)
    return blocks, warnings, Stats(sheets=len(wb.sheetnames), rows=limits.rows)


def read_xls(path: Path, settings: Settings, deadline: Deadline, budget: TextBudget) -> tuple[list[Block], list[Warning], Stats]:
    try:
        wb = xlrd.open_workbook(path, on_demand=True, formatting_info=False)
    except Exception as e:  # noqa: BLE001
        raise ProcessingError("CORRUPT_FILE", "The workbook could not be parsed.") from e
    try:
        if wb.nsheets > settings.max_spreadsheet_sheets:
            raise ProcessingError("SPREADSHEET_LIMIT_EXCEEDED", "The workbook has too many sheets.")
        limits = _Limits(settings, deadline, budget)
        blocks: list[Block] = []
        for si in range(wb.nsheets):
            sh = wb.sheet_by_index(si)
            for r in range(sh.nrows):
                values = []
                for c in range(sh.ncols):
                    cell = sh.cell(r, c)
                    if cell.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
                        continue
                    v = xlrd.xldate.xldate_as_datetime(cell.value, wb.datemode) if cell.ctype == xlrd.XL_CELL_DATE else cell.value
                    if t := _text(v):
                        values.append((c + 1, t))
                if not values:
                    continue
                block = _row_block(sh.name, r + 1, values, len(blocks) + 1)
                limits.row(block.text, len(values))
                blocks.append(block)
            wb.unload_sheet(si)
        return blocks, [], Stats(sheets=wb.nsheets, rows=limits.rows)
    except ProcessingError:
        raise
    except Exception as e:  # noqa: BLE001
        raise ProcessingError("CORRUPT_FILE", "The workbook could not be read.") from e
    finally:
        wb.release_resources()


def _decode(raw: bytes) -> tuple[str, list[Warning]]:
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16"), []
    try:
        return raw.decode("utf-8-sig"), []
    except UnicodeDecodeError:
        return raw.decode("cp1252", errors="replace"), [Warning(code="ENCODING_ASSUMED", message="The CSV is not UTF-8; Windows-1252 was assumed.")]


def read_csv(path: Path, settings: Settings, deadline: Deadline, budget: TextBudget) -> tuple[list[Block], list[Warning], Stats]:
    raw = path.read_bytes()
    if b"\x00" in raw[:4096] and not raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        raise ProcessingError("UNSUPPORTED_FILE", "The file does not look like a CSV text file.")
    text, warnings = _decode(raw)
    try:
        dialect = csv.Sniffer().sniff(text[:8192], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
        dialect.delimiter = ","  # type: ignore[misc]
    csv.field_size_limit(1_000_000)
    limits = _Limits(settings, deadline, budget)
    blocks: list[Block] = []
    try:
        for row_no, row in enumerate(csv.reader(io.StringIO(text, newline=""), dialect), start=1):
            values = [(c, v.strip()) for c, v in enumerate(row, start=1) if v.strip()]
            if not values:
                continue
            block = _row_block("csv", row_no, values, len(blocks) + 1)
            limits.row(block.text, len(values))
            blocks.append(block)
    except csv.Error as e:
        raise ProcessingError("CORRUPT_FILE", "The CSV could not be parsed.") from e
    return blocks, warnings, Stats(sheets=1, rows=limits.rows)
