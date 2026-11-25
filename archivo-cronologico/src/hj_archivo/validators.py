"""Validaciones de identificadores, pesos y fechas.

Cada validador devuelve un ``Check`` con el valor normalizado (o None) y, si procede,
el motivo del aviso. Ningún validador «repara» un dato inventando caracteres: solo
normaliza formato (espacios, guiones, mayúsculas).
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE"
CIF_LETTER_CONTROL = "JABCDEFGHI"


@dataclass
class Check:
    ok: bool
    value: object = None
    message: str | None = None
    kind: str | None = None  # p. ej. 'DNI', 'NIE', 'CIF'


# ---------------------------------------------------------------- NIF / CIF / NIE
def _clean_id(s: str) -> str:
    return re.sub(r"[\s.\-/]", "", s or "").upper()


def validate_nif(raw: str) -> Check:
    s = _clean_id(raw)
    if s.startswith("ES") and len(s) == 11:  # NIF-IVA intracomunitario
        s = s[2:]
    if not s:
        return Check(False, None, "NIF vacío")
    if re.fullmatch(r"\d{8}[A-Z]", s):
        ok = DNI_LETTERS[int(s[:8]) % 23] == s[8]
        return Check(ok, s, None if ok else "Letra de control del DNI incorrecta", "DNI")
    if re.fullmatch(r"[XYZ]\d{7}[A-Z]", s):
        num = int("XYZ".index(s[0]).__str__() + s[1:8])
        ok = DNI_LETTERS[num % 23] == s[8]
        return Check(ok, s, None if ok else "Letra de control del NIE incorrecta", "NIE")
    if re.fullmatch(r"[KLM]\d{7}[A-Z]", s):
        ok = DNI_LETTERS[int(s[1:8]) % 23] == s[8]
        return Check(ok, s, None if ok else "Letra de control del NIF especial incorrecta", "NIF-KLM")
    if re.fullmatch(r"[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]", s):
        digits = s[1:8]
        total = 0
        for i, ch in enumerate(digits):
            d = int(ch)
            if i % 2 == 0:  # posiciones impares (1,3,5,7)
                d *= 2
                d = d // 10 + d % 10
            total += d
        ctrl = (10 - total % 10) % 10
        letter, digit = CIF_LETTER_CONTROL[ctrl], str(ctrl)
        org = s[0]
        last = s[8]
        if org in "PQRSNW":
            ok = last == letter
        elif org in "ABEH":
            ok = last == digit
        else:
            ok = last in (letter, digit)
        return Check(ok, s, None if ok else "Dígito de control del CIF incorrecto", "CIF")
    return Check(False, s, "Formato de NIF/CIF/NIE no reconocido")


# ---------------------------------------------------------------- NIMA
def validate_nima(raw: str) -> Check:
    """NIMA: 10 dígitos; los dos primeros son el código de provincia (01–52).

    Se devuelve como texto para conservar el cero inicial.
    """
    s = re.sub(r"\D", "", raw or "")
    if len(s) != 10:
        return Check(False, s or None, f"El NIMA debe tener 10 dígitos (tiene {len(s)})")
    prov = int(s[:2])
    if not 1 <= prov <= 52:
        return Check(False, s, f"Código de provincia {s[:2]} no válido en el NIMA")
    return Check(True, s)


# ---------------------------------------------------------------- LER
_LER_RE = re.compile(r"(\d{2})\s*[.\-]?\s*(\d{2})\s*[.\-]?\s*(\d{2})\s*(\*)?")


def normalize_ler(raw: str) -> Check:
    """Normaliza un código LER a «17 01 07» (o «17 06 05*» si es peligroso)."""
    m = _LER_RE.search(raw or "")
    if not m:
        return Check(False, None, "Código LER no reconocido")
    code = f"{m.group(1)} {m.group(2)} {m.group(3)}" + ("*" if m.group(4) else "")
    if not 1 <= int(m.group(1)) <= 20:
        return Check(False, code, "El capítulo LER debe estar entre 01 y 20")
    return Check(True, code)


def validate_ler(raw: str, catalog: dict[str, dict] | None = None) -> Check:
    c = normalize_ler(raw)
    if not c.ok or catalog is None:
        return c
    code = c.value
    if code in catalog:
        return c
    alt = code[:-1] if code.endswith("*") else code + "*"
    if alt in catalog:
        return Check(False, code, f"El código existe como {alt}: revisar el asterisco de peligrosidad")
    return Check(False, code, "Código LER no encontrado en el catálogo")


# ---------------------------------------------------------------- Pesos
_UNIT_KG = {"KG", "KGS", "KILOS", "KILOGRAMOS", "K"}
_UNIT_T = {"T", "TN", "TNS", "TM", "TON", "TONELADAS", "TONELADA", "TONS"}
_WEIGHT_RE = re.compile(r"(\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)\s*([A-Za-z.]{0,10})")


@dataclass
class Weight:
    kg: Decimal
    raw: str
    unit_found: str | None   # 'kg', 't' o None si no aparece unidad
    ambiguous: bool          # True si la interpretación del separador es dudosa


def parse_number_es(num: str) -> tuple[Decimal, bool]:
    """Convierte un número escrito al estilo español. Devuelve (valor, ambiguo).

    «11.440» → 11440 (punto de miles), «4,34» → 4.34, «1.234,5» → 1234.5.
    «4.34» se interpreta como decimal pero se marca como ambiguo.
    """
    s = num.strip().replace(" ", ".")
    if "," in s and "." in s:
        return Decimal(s.replace(".", "").replace(",", ".")), False
    if "," in s:
        return Decimal(s.replace(",", ".")), False
    if "." in s:
        parts = s.split(".")
        if all(len(p) == 3 for p in parts[1:]):
            return Decimal(s.replace(".", "")), False
        return Decimal(s), True
    return Decimal(s), False


def parse_weight(raw: str, default_unit: str | None = None, max_kg: Decimal = Decimal(60000)) -> Check:
    """Extrae un peso y lo devuelve en kilogramos (Decimal).

    ``max_kg`` es un límite de plausibilidad (carga de un camión) que detecta
    confusiones entre kg y t o entre separadores de miles y decimales.

    Si no hay unidad y ``default_unit`` es None, el resultado se marca como no
    válido para obligar a revisión: no se asume la unidad.
    """
    if not raw:
        return Check(False, None, "Peso vacío")
    m = _WEIGHT_RE.search(raw)
    if not m:
        return Check(False, None, "No se encontró un número de peso")
    try:
        value, ambiguous = parse_number_es(m.group(1))
    except InvalidOperation:
        return Check(False, None, "Número de peso no válido")
    unit_txt = m.group(2).upper().rstrip(".") if m.group(2) else ""
    if unit_txt in _UNIT_KG:
        unit = "kg"
    elif unit_txt in _UNIT_T:
        unit = "t"
    else:
        unit = None
    eff = unit or default_unit
    if eff is None:
        return Check(False, Weight(value, raw, None, True), "Peso sin unidad: confirmar kg o t")
    kg = value * 1000 if eff == "t" else value
    w = Weight(kg, raw, unit, ambiguous)
    if kg <= 0:
        return Check(False, w, "El peso debe ser positivo")
    if kg > max_kg:
        return Check(False, w, f"Peso fuera de rango ({kg} kg > {max_kg} kg): revisar unidad y separadores")
    if ambiguous:
        return Check(False, w, "Separador decimal/miles ambiguo: confirmar el peso")
    if unit is None:
        return Check(True, w, f"Unidad no indicada; se asumió {eff} por configuración")
    return Check(True, w)


def kg_to_unit(kg: Decimal, unit: str) -> Decimal:
    return kg / 1000 if unit == "t" else kg


# ---------------------------------------------------------------- Fechas
_DATE_RE = re.compile(r"(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2,4})")
_ISO_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")


def parse_date(raw: str, min_year: int = 2000, max_future_days: int = 31) -> Check:
    """Fechas españolas (día/mes/año). No acepta formatos mes/día."""
    if not raw:
        return Check(False, None, "Fecha vacía")
    m = _ISO_RE.search(raw)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    else:
        m = _DATE_RE.search(raw)
        if not m:
            return Check(False, None, "Fecha no reconocida")
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if y < 100:
            y += 2000
    try:
        dt = date(y, mo, d)
    except ValueError:
        return Check(False, None, f"Fecha imposible: {raw!r}")
    if dt.year < min_year:
        return Check(False, dt, "Fecha anterior al año mínimo configurado")
    if (dt - datetime.now().date()).days > max_future_days:
        return Check(False, dt, "Fecha en el futuro")
    return Check(True, dt)


# ---------------------------------------------------------------- DI / ticket
def validate_di(raw: str, pattern: str | None = None) -> Check:
    """Número de documento de identificación.

    El patrón exacto depende del emisor (Hermanos Jiménez, RECYTRACK, e-SIR) y se
    configura en cada formato. Sin patrón solo se exige un identificador alfanumérico
    razonable. Se conserva siempre como texto.
    """
    s = re.sub(r"\s+", "", raw or "").upper()
    if not s:
        return Check(False, None, "DI vacío")
    if pattern:
        ok = re.fullmatch(pattern, s) is not None
        return Check(ok, s, None if ok else "El DI no cumple el patrón configurado para el formato")
    if not re.fullmatch(r"[A-Z0-9/\-_.]{4,60}", s):
        return Check(False, s, "Caracteres no esperados en el DI")
    return Check(True, s)


def validate_ticket(raw: str, pattern: str | None = None) -> Check:
    s = (raw or "").strip()
    if not s:
        return Check(False, None, "Ticket no presente")
    if pattern and not re.fullmatch(pattern, s):
        return Check(False, s, "El ticket no cumple el patrón configurado")
    return Check(True, s)
