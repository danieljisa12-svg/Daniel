"""Motor de extracción basado en etiquetas y secciones (independiente del formato).

Entrada: líneas de texto (de la capa de texto del PDF o del OCR), cada una con su
confianza y página. Salida: ``ExtractedDocument`` con un ``FieldValue`` por campo
definido en el formato, incluido el texto original y la procedencia.

La lectura de casillas marcadas, sellos y QR requiere la imagen y se implementa en
la fase 2 (``vision``); aquí esos campos quedan PENDIENTES, nunca rellenados.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal

from . import validators as v
from .formats import FieldDef, FormatDef
from .models import ExtractedDocument, FieldValue, Source, Status
from .text import fuzzy_contains, norm, norm_keep


@dataclass
class Line:
    text: str
    confidence: float = 1.0
    page: int = 1
    source: Source = Source.PDF_TEXT


# ------------------------------------------------------------------ secciones
def assign_sections(lines: list[Line], fmt: FormatDef) -> list[str | None]:
    """Asigna a cada línea la sección en la que se encuentra.

    Una línea inicia sección si empieza por (o es casi igual a) uno de los
    encabezados de esa sección.
    """
    current: str | None = None
    out: list[str | None] = []
    for ln in lines:
        n = norm(ln.text)
        for sec in fmt.sections:
            for head in sec.get("inicio", []):
                h = norm(head)
                if n.startswith(h) or (len(n) <= len(h) + 6 and fuzzy_contains(n, head, 0.88)):
                    current = sec["id"]
                    break
            else:
                continue
            break
        out.append(current)
    return out


# ------------------------------------------------------------------ etiquetas
@dataclass
class _Hit:
    field: FieldDef
    start: int
    end: int
    label_len: int


def _label_regex(label: str) -> re.Pattern:
    parts = [re.escape(p) for p in norm(label).split()]
    return re.compile(r"(?<![A-Z0-9])" + r"\s*".join(parts) + r"(?![A-Z0-9])")


def _find_hits(text_norm: str, candidates: list[FieldDef], section: str | None) -> list[_Hit]:
    hits: list[_Hit] = []
    for fd in candidates:
        if fd.type in ("casilla", "sello"):
            continue
        for lab in fd.labels:
            for m in _label_regex(lab).finditer(text_norm):
                hits.append(_Hit(fd, m.start(), m.end(), len(norm(lab))))
    # Preferencia: etiqueta más larga; a igualdad, campo específico de la sección.
    hits.sort(key=lambda h: (-h.label_len, 0 if h.field.section == section and section else 1, h.start))
    chosen: list[_Hit] = []
    for h in hits:
        if any(not (h.end <= c.start or h.start >= c.end) for c in chosen):
            continue
        if any(c.field.key == h.field.key for c in chosen):
            continue
        chosen.append(h)
    return sorted(chosen, key=lambda h: h.start)


def _clean_value(s: str) -> str:
    # Se conserva el punto final (p. ej. «S.L.»); solo se retiran separadores.
    return s.lstrip(" :.-–=\t|").rstrip(" :-–=\t|").strip()


# ------------------------------------------------------------------ tipos
_NIF_RE = re.compile(r"(?<![A-Z0-9])([A-Z]\d{7}[0-9A-J]|\d{8}[A-Z]|[XYZ]\d{7}[A-Z])(?![A-Z0-9])")
_NIMA_RE = re.compile(r"(?<!\d)(\d{10})(?!\d)")
_OP_RE = re.compile(r"(?<![A-Z])([RD])\s*(\d{1,2})(?!\d)")


def parse_typed(fd: FieldDef, raw: str, catalogs: dict | None = None) -> tuple[object, Status, list[str]]:
    catalogs = catalogs or {}
    raw = raw or ""
    if not raw.strip():
        return None, Status.PENDIENTE, ["Sin valor tras la etiqueta"]
    t = fd.type
    if t == "texto":
        return raw.strip(), Status.OK, []
    if t == "nif":
        compact = re.sub(r"(?<=[A-Z0-9])[\s.\-](?=[A-Z0-9])", "", raw.upper())
        m = _NIF_RE.search(compact)
        if not m:
            return None, Status.PENDIENTE, [f"No se reconoce un NIF en {raw!r}"]
        c = v.validate_nif(m.group(1))
        return c.value, Status.OK if c.ok else Status.DUDOSO, [c.message] if c.message else []
    if t == "nima":
        m = _NIMA_RE.search(re.sub(r"(?<=\d)[\s.](?=\d)", "", raw))
        if not m:
            return None, Status.PENDIENTE, [f"No se reconoce un NIMA en {raw!r}"]
        c = v.validate_nima(m.group(1))
        return c.value, Status.OK if c.ok else Status.DUDOSO, [c.message] if c.message else []
    if t == "ler":
        c = v.validate_ler(raw, catalogs.get("ler"))
        if c.value is None:
            return None, Status.PENDIENTE, [c.message]
        return c.value, Status.OK if c.ok else Status.DUDOSO, [c.message] if c.message else []
    if t == "peso":
        c = v.parse_weight(raw)
        if c.value is None:
            return None, Status.PENDIENTE, [c.message]
        return c.value, Status.OK if c.ok else Status.DUDOSO, [c.message] if c.message else []
    if t == "fecha":
        c = v.parse_date(raw)
        if c.value is None:
            return None, Status.PENDIENTE, [c.message]
        return c.value, Status.OK if c.ok else Status.DUDOSO, [c.message] if c.message else []
    if t == "operacion":
        m = _OP_RE.search(raw.upper())
        if not m:
            return None, Status.PENDIENTE, [f"No se reconoce una operación R/D en {raw!r}"]
        code = f"{m.group(1)}{int(m.group(2))}"
        ops = catalogs.get("operaciones")
        if ops is not None and code not in ops:
            return code, Status.DUDOSO, [f"Operación {code} no está en el catálogo"]
        return code, Status.OK, []
    if t == "di":
        tok = re.search(r"[A-Z0-9][A-Z0-9/\-_.]{3,59}", raw.upper().replace(" ", ""))
        if not tok:
            return None, Status.PENDIENTE, [f"No se reconoce un DI en {raw!r}"]
        c = v.validate_di(tok.group(0), fd.pattern)
        return c.value, Status.OK if c.ok else Status.DUDOSO, [c.message] if c.message else []
    if t == "ticket":
        tok = raw.strip().split()[0]
        c = v.validate_ticket(tok, fd.pattern)
        return c.value, Status.OK if c.ok else Status.DUDOSO, [c.message] if c.message else []
    return None, Status.PENDIENTE, [f"Tipo {t} requiere análisis de imagen"]


def _same(a: object, b: object) -> bool:
    if isinstance(a, v.Weight) and isinstance(b, v.Weight):
        return a.kg == b.kg
    return a == b


# ------------------------------------------------------------------ extracción
def extract_fields(lines: list[Line], fmt: FormatDef, catalogs: dict | None = None,
                   min_confidence: float = 0.80) -> ExtractedDocument:
    doc = ExtractedDocument(format_id=fmt.id, format_score=0.0)
    doc.pages = sorted({ln.page for ln in lines})
    sections = assign_sections(lines, fmt)
    fields = list(fmt.fields.values())

    for i, ln in enumerate(lines):
        sec = sections[i]
        candidates = [f for f in fields if f.section is None or f.section == sec]
        tn = norm_keep(ln.text)
        hits = _find_hits(tn, candidates, sec)
        for j, h in enumerate(hits):
            end = hits[j + 1].start if j + 1 < len(hits) else len(tn)
            raw = _clean_value(ln.text[h.end:end])
            raw_orig_line = ln.text
            conf = ln.confidence
            src = ln.source
            if not raw and i + 1 < len(lines):
                nxt = lines[i + 1]
                nn = norm_keep(nxt.text)
                if nn.strip() and not _find_hits(nn, candidates, sec) and sections[i + 1] == sec:
                    raw, raw_orig_line, conf, src = _clean_value(nxt.text), f"{ln.text}\n{nxt.text}", min(conf, nxt.confidence), nxt.source
            value, status, notes = parse_typed(h.field, raw, catalogs)
            if value is not None and conf < min_confidence:
                status = Status.DUDOSO if status == Status.OK else status
                notes.append(f"Confianza de lectura baja ({conf:.0%})")
            fv = FieldValue(value=value, raw_text=raw_orig_line, confidence=conf if value is not None else 0.0,
                            source=src, page=ln.page, status=status if value is not None else Status.PENDIENTE,
                            notes=notes)
            prev = doc.fields.get(h.field.key)
            if prev is None or prev.value is None:
                doc.fields[h.field.key] = fv
            elif value is not None and not _same(prev.value, value):
                prev.flag(Status.CONTRADICTORIO, f"Otro valor encontrado en la página {ln.page}: {raw!r}")

    for fd in fields:
        if fd.key not in doc.fields:
            note = "Requiere análisis de imagen (casillas/sellos)" if fd.type in ("casilla", "sello") else "Etiqueta no encontrada en el documento"
            doc.fields[fd.key] = FieldValue.missing(note)

    apply_rules(doc, fmt)
    return doc


# ------------------------------------------------------------------ reglas de negocio
def apply_rules(doc: ExtractedDocument, fmt: FormatDef) -> None:
    rules = fmt.rules
    qty = rules.get("cantidad_recibida")
    if qty:
        src_key = qty["usar"]
        src = doc.fields.get(src_key, FieldValue.missing())
        if src.value is not None:
            result = FieldValue(value=src.value, raw_text=src.raw_text, confidence=src.confidence,
                                source=src.source, page=src.page, status=src.status,
                                notes=list(src.notes) + [f"Tomado de '{src_key}' según la regla del formato"])
        else:
            result = FieldValue.missing(f"No se encontró '{src_key}'. No se usa {qty.get('nunca', [])} como sustituto.")
        for forbidden in qty.get("nunca", []):
            other = doc.fields.get(forbidden)
            if other and other.value is not None and result.value is not None:
                if isinstance(other.value, v.Weight) and isinstance(result.value, v.Weight):
                    diff = result.value.kg - other.value.kg
                    result.notes.append(f"Referencia ({forbidden}): {other.value.kg} kg; diferencia {diff:+} kg")
        doc.fields["cantidad_recibida"] = result

    for key in ("numero_ticket", "tratamiento"):
        r = rules.get(key)
        if r and r.get("si_ausente") == "pendiente":
            fv = doc.fields.get(key)
            if fv is None or fv.value is None:
                doc.fields[key] = FieldValue.missing(r.get("nota") or "Ausente en el documento: pendiente de revisión")

    acc = rules.get("aceptacion")
    if acc is not None:
        # Sin regla aprobada por el usuario la aceptación nunca se deduce.
        if not acc.get("regla_aprobada"):
            doc.fields["aceptacion"] = FieldValue.missing(acc.get("nota") or "Aceptación pendiente: no hay regla aprobada")


def weight_in(fv: FieldValue, unit: str) -> Decimal | None:
    if isinstance(fv.value, v.Weight):
        return v.kg_to_unit(fv.value.kg, unit)
    return None
