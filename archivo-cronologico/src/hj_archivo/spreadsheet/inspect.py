"""Inspección de solo lectura del archivo cronológico (ODS y XLSX).

ODS se lee directamente del XML (``content.xml``) con lxml para ver exactamente lo
que hay guardado: tipos de valor, estilos, fórmulas, filtros y filas repetidas. Es
la misma vía que usará el escritor seguro (fase 4), que modificará únicamente las
filas nuevas y dejará intacto el resto del paquete.

Nada en este módulo escribe en disco.
"""
from __future__ import annotations

import re
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from lxml import etree

from .. import schema

NS = {
    "office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
    "table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
    "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
}
T = "{%s}" % NS["table"]
O = "{%s}" % NS["office"]
MAX_EXPAND = 2000  # límite para expandir celdas repetidas en una fila
MAX_EMPTY_REPEAT = 1000  # bloques de filas vacías mayores no se expanden


@dataclass
class Cell:
    value: str | None
    value_type: str | None
    style: str | None
    formula: str | None
    raw_value: str | None = None  # office:value / date-value


@dataclass
class SheetData:
    name: str
    rows: list[list[Cell]]
    total_rows: int  # incluidas las repetidas vacías del final
    numbering_unreliable: bool = False


@dataclass
class Report:
    path: str
    fmt: str
    sheets: list[dict] = field(default_factory=list)
    target_found: bool = False
    header_problems: list[str] = field(default_factory=list)
    headers_found: list[str | None] = field(default_factory=list)
    title_rows: list[list[str | None]] = field(default_factory=list)
    data_rows: int = 0
    last_data_row: int | None = None
    next_free_row: int | None = None
    gaps: list[int] = field(default_factory=list)
    column_types: dict[str, dict[str, int]] = field(default_factory=dict)
    column_styles: dict[str, dict[str, int]] = field(default_factory=dict)
    formulas: dict[str, int] = field(default_factory=dict)
    filters: list[str] = field(default_factory=list)
    precision_risks: list[str] = field(default_factory=list)
    duplicate_di: dict[str, list[int]] = field(default_factory=dict)
    numero_pattern: str | None = None
    units_hint: str | None = None


def _cell_text(el) -> str | None:
    ps = el.findall(".//{%s}p" % NS["text"])
    if not ps:
        return None
    return "\n".join("".join(p.itertext()) for p in ps)


def read_ods(path: Path) -> list[SheetData]:
    with zipfile.ZipFile(path) as z:
        root = etree.fromstring(z.read("content.xml"))
    sheets = []
    for tbl in root.iter(T + "table"):
        rows: list[list[Cell]] = []
        total = 0
        truncated = unreliable = False
        for row in tbl.iter(T + "table-row"):
            rep = int(row.get(T + "number-rows-repeated", "1"))
            cells: list[Cell] = []
            for c in row:
                if c.tag not in (T + "table-cell", T + "covered-table-cell"):
                    continue
                crep = int(c.get(T + "number-columns-repeated", "1"))
                vt = c.get(O + "value-type")
                raw = c.get(O + "value") or c.get(O + "date-value") or c.get(O + "time-value") or c.get(O + "boolean-value")
                cell = Cell(_cell_text(c), vt, c.get(T + "style-name"), c.get(T + "formula"), raw)
                empty = cell.value is None and vt is None and cell.formula is None
                cells.extend([cell] * (min(crep, MAX_EXPAND) if not empty else min(crep, 64)))
            empty_row = all(x.value is None and x.value_type is None for x in cells)
            if empty_row and rep > MAX_EMPTY_REPEAT:
                # Relleno final típico (p. ej. 1.048.000 filas vacías): no se expande.
                # Si hubiera datos después, la numeración se marcaría como no fiable.
                truncated = True
            else:
                if truncated and not empty_row:
                    unreliable = True
                rows.extend([cells] * rep)
            total += rep
        sheets.append(SheetData(tbl.get(T + "name"), rows, total, unreliable))
    return sheets


def ods_filters(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as z:
        root = etree.fromstring(z.read("content.xml"))
    out = []
    for dr in root.iter(T + "database-range"):
        out.append(f"{dr.get(T + 'name')}: {dr.get(T + 'target-range-address')} (filtro={dr.get(T + 'display-filter-buttons')})")
    return out


def read_xlsx(path: Path) -> tuple[list[SheetData], list[str]]:
    import openpyxl

    wb = openpyxl.load_workbook(path, data_only=False, read_only=False)
    sheets, filters = [], []
    for ws in wb.worksheets:
        rows = []
        for r in ws.iter_rows(min_row=1, max_row=ws.max_row, max_col=min(ws.max_column, 64)):
            row = []
            for c in r:
                v = c.value
                formula = v if isinstance(v, str) and v.startswith("=") else None
                vt = None if v is None else ("formula" if formula else type(v).__name__)
                row.append(Cell(None if v is None else str(v), vt, c.style_id.__str__() if c.has_style else None, formula, None))
            rows.append(row)
        sheets.append(SheetData(ws.title, rows, ws.max_row))
        if ws.auto_filter and ws.auto_filter.ref:
            filters.append(f"{ws.title}: {ws.auto_filter.ref}")
    return sheets, filters


_SCI_RE = re.compile(r"^\d(\.\d+)?E\+\d+$", re.I)


def analyze(path: str | Path) -> Report:
    path = Path(path)
    ext = path.suffix.lower()
    if ext == ".ods":
        sheets, filters = read_ods(path), ods_filters(path)
    elif ext in (".xlsx", ".xlsm"):
        sheets, filters = read_xlsx(path)
    else:
        raise ValueError(f"Formato no soportado: {ext}")
    rep = Report(str(path), ext[1:], filters=filters)
    for s in sheets:
        width = max((len(r) for r in s.rows), default=0)
        rep.sheets.append({"nombre": s.name, "filas_declaradas": s.total_rows, "ancho": width})
    target = next((s for s in sheets if s.name == schema.SHEET_NAME), None)
    if target is None:
        return rep
    rep.target_found = True
    rows = target.rows
    if target.numbering_unreliable:
        rep.header_problems.append("Aviso: hay datos tras un bloque grande de filas vacías; revisar manualmente")

    def row(n: int) -> list[Cell]:
        return rows[n - 1] if n - 1 < len(rows) else []

    hdr = row(schema.HEADER_ROW)
    rep.headers_found = [c.value for c in hdr[:26]] + [None] * max(0, 26 - len(hdr))
    rep.header_problems = schema.compare_headers(rep.headers_found) + rep.header_problems
    rep.title_rows = [[c.value for c in row(n)[:26] if c.value] for n in range(1, schema.HEADER_ROW)]

    types: dict[str, Counter] = defaultdict(Counter)
    styles: dict[str, Counter] = defaultdict(Counter)
    formulas: Counter = Counter()
    di_rows: dict[str, list[int]] = defaultdict(list)
    numeros: list[str] = []
    last = None
    for n in range(schema.FIRST_DATA_ROW, len(rows) + 1):
        r = row(n)
        filled = [c for c in r[:26] if c.value is not None or c.formula]
        if not filled:
            continue
        if last is not None and n != last + 1:
            rep.gaps.extend(range(last + 1, n))
        last = n
        rep.data_rows += 1
        for col in schema.COLUMNS:
            i = schema.column_index(col.letter)
            c = r[i] if i < len(r) else None
            if c is None or (c.value is None and not c.formula):
                types[col.letter]["vacía"] += 1
                continue
            types[col.letter][c.value_type or "sin tipo"] += 1
            if c.style:
                styles[col.letter][c.style] += 1
            if c.formula:
                formulas[col.letter] += 1
            if col.as_text and c.value_type in ("float", "int", "percentage", "currency"):
                if c.value and (_SCI_RE.match(c.value) or len(re.sub(r"\D", "", c.value)) >= 10):
                    rep.precision_risks.append(f"{col.letter}{n}: identificador numérico con riesgo de precisión ({c.value})")
            if col.key == "di" and c.value:
                di_rows[c.value.strip()].append(n)
            if col.key == "numero" and c.value:
                numeros.append(c.value)
    rep.last_data_row = last
    rep.next_free_row = (last + 1) if last else schema.FIRST_DATA_ROW
    rep.column_types = {k: dict(v) for k, v in types.items()}
    rep.column_styles = {k: dict(v) for k, v in styles.items()}
    rep.formulas = dict(formulas)
    rep.duplicate_di = {k: v for k, v in di_rows.items() if len(v) > 1}
    if numeros:
        if all(re.fullmatch(r"\d+", x) for x in numeros):
            ints = [int(x) for x in numeros]
            seq = all(b - a == 1 for a, b in zip(ints, ints[1:]))
            rep.numero_pattern = f"enteros {'correlativos' if seq else 'no correlativos'} ({ints[0]}…{ints[-1]})"
        else:
            rep.numero_pattern = "mixto: " + ", ".join(sorted({re.sub(r"\d", "9", x) for x in numeros})[:5])
    return rep
