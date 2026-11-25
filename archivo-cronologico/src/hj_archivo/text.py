"""Normalización de texto tolerante a errores típicos de OCR."""
from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def norm(s: str) -> str:
    """Mayúsculas, sin tildes y con espacios colapsados (para comparar etiquetas)."""
    s = strip_accents(s).upper()
    s = re.sub(r"[^\w%/.,:\-º°ª]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def fuzzy_contains(haystack_norm: str, needle: str, threshold: float = 0.85) -> float:
    """Puntuación 0..1 de la mejor coincidencia aproximada de ``needle`` en el texto.

    Permite detectar encabezados con errores de OCR ("RECYTRAK", "0PERADOR").
    """
    n = norm(needle)
    if not n:
        return 0.0
    if n in haystack_norm:
        return 1.0
    words = haystack_norm.split()
    k = len(n.split())
    best = 0.0
    for i in range(max(1, len(words) - k + 1)):
        cand = " ".join(words[i : i + k])
        r = SequenceMatcher(None, cand, n).ratio()
        if r > best:
            best = r
            if best == 1.0:
                break
    return best if best >= threshold else 0.0


_ALLOWED_EXTRA = set("%/.,:-º°ª*")


def norm_keep(s: str) -> str:
    """Normalización que conserva la longitud: la posición i equivale a s[i].

    Sirve para localizar etiquetas sin tildes ni mayúsculas y luego recortar el
    valor del texto original (con sus tildes y mayúsculas).
    """
    out = []
    for ch in s:
        base = unicodedata.normalize("NFD", ch)[0]
        up = base.upper()
        if len(up) != 1:
            up = base
        out.append(up if (up.isalnum() or up in _ALLOWED_EXTRA) else " ")
    return "".join(out)
