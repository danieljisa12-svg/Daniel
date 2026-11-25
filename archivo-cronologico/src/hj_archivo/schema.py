"""Estructura exacta de la hoja AGENTE_Y_TRANSPORTISTA del archivo cronológico.

Fuente: especificación del proyecto (sección 6). Pendiente de contrastar con PRUEBA.ods
mediante ``tools/analizar_referencias.py``; la herramienta compara estas cabeceras con
las reales carácter a carácter.
"""
from __future__ import annotations

from dataclasses import dataclass

SHEET_NAME = "AGENTE_Y_TRANSPORTISTA"
HEADER_ROW = 5  # 1-based, como en la hoja de cálculo
FIRST_DATA_ROW = 6


@dataclass(frozen=True)
class Column:
    letter: str
    header: str
    key: str
    as_text: bool  # identificadores: se escriben siempre como texto


COLUMNS: tuple[Column, ...] = (
    Column("A", "NUMERO", "numero", True),
    Column("B", "NUMERO TICKET", "numero_ticket", True),
    Column("C", "FECHA", "fecha", False),
    Column("D", "DI", "di", True),
    Column("E", "CODIGO LER", "codigo_ler", True),
    Column("F", "DESCRIPCIÓN CÓDIGO LER", "descripcion_ler", True),
    Column("G", "NOMBRE/RAZÓN SOCIAL", "g_nombre", True),
    Column("H", "DIRECCIÓN", "g_direccion", True),
    Column("I", "NIF", "g_nif", True),
    Column("J", "NIMA", "g_nima", True),
    Column("K", "Nº INSCRIPCION", "g_inscripcion", True),
    Column("L", "NOMBRE/RAZÓN SOCIAL3", "l_nombre", True),
    Column("M", "DIRECCIÓN4", "l_direccion", True),
    Column("N", "NIF5", "l_nif", True),
    Column("O", "NIMA6", "l_nima", True),
    Column("P", "Nº INSCRIPCION7", "l_inscripcion", True),
    Column("Q", "NOMBRE/RAZÓN SOCIAL2", "q_nombre", True),
    Column("R", "NIF2", "q_nif", True),
    Column("S", "NIMA2", "q_nima", True),
    Column("T", "Nº INSCRIPCION2", "q_inscripcion", True),
    Column("U", "OPERACIÓN DE TRATAMIENTO", "operacion_tratamiento", True),
    Column("V", "CANTIDAD RECIBIDA", "cantidad_recibida", False),
    Column("W", "FECHA DE ENTREGA", "fecha_entrega", False),
    Column("X", "FECHA DE ACEPTACIÓN/RECHAZO", "fecha_aceptacion", False),
    Column("Y", "ACEPTACIÓN SI/NO", "aceptacion", True),
    Column("Z", "OBSERVACIONES", "observaciones", True),
)

COLUMN_BY_KEY = {c.key: c for c in COLUMNS}
COLUMN_BY_LETTER = {c.letter: c for c in COLUMNS}
EXPECTED_HEADERS = tuple(c.header for c in COLUMNS)


def column_index(letter: str) -> int:
    """Índice 0-based de una letra de columna (A=0, Z=25, AA=26)."""
    idx = 0
    for ch in letter.upper():
        idx = idx * 26 + (ord(ch) - ord("A") + 1)
    return idx - 1


def compare_headers(found: list[str | None]) -> list[str]:
    """Devuelve las discrepancias entre las cabeceras encontradas y las esperadas.

    La comparación es exacta (mayúsculas, tildes y espacios incluidos) porque el
    requisito es no alterar las cabeceras. Los espacios sobrantes en los extremos se
    señalan aparte como aviso, no se corrigen.
    """
    problems: list[str] = []
    for col in COLUMNS:
        i = column_index(col.letter)
        got = found[i] if i < len(found) else None
        if got == col.header:
            continue
        if got is not None and got.strip() == col.header:
            problems.append(f"{col.letter}: espacios en los extremos en {got!r}")
        else:
            problems.append(f"{col.letter}: esperado {col.header!r}, encontrado {got!r}")
    return problems
