"""Modelo de datos extraídos con procedencia y confianza por campo.

Principio rector: nunca se inventa un valor. Un campo sin evidencia queda con
``value=None`` y estado ``PENDIENTE``; el texto original y su origen se conservan
siempre para auditoría y para la pantalla de revisión.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Source(str, Enum):
    PDF_TEXT = "pdf_texto"        # capa de texto nativa del PDF
    OCR = "ocr"                   # OCR local (Tesseract)
    QR = "qr"                     # código QR
    CHECKBOX = "casilla"          # casilla marcada detectada por visión
    STAMP = "sello"               # texto OCR dentro de un sello
    AI = "ia_externa"             # IA multimodal opcional (requiere autorización)
    DATABASE = "base_datos"       # completado desde datos verificados
    RULE = "regla"                # regla autorizada por el usuario
    USER = "usuario"              # corregido o introducido manualmente


# Orígenes que representan lectura directa del documento (se muestran distinto
# de los completados desde base de datos o reglas).
DOCUMENT_SOURCES = {Source.PDF_TEXT, Source.OCR, Source.QR, Source.CHECKBOX, Source.STAMP, Source.AI}


class Status(str, Enum):
    OK = "ok"
    DUDOSO = "dudoso"             # baja confianza o validación con aviso
    PENDIENTE = "pendiente"       # ausente o ilegible: requiere revisión
    CONTRADICTORIO = "contradictorio"  # dos evidencias incompatibles


@dataclass
class FieldValue:
    value: Any = None
    raw_text: str | None = None
    confidence: float = 0.0       # 0..1
    source: Source | None = None
    page: int | None = None
    bbox: tuple[float, float, float, float] | None = None
    status: Status = Status.PENDIENTE
    notes: list[str] = field(default_factory=list)

    @classmethod
    def missing(cls, note: str | None = None) -> "FieldValue":
        return cls(notes=[note] if note else [])

    @property
    def from_document(self) -> bool:
        return self.source in DOCUMENT_SOURCES

    def flag(self, status: Status, note: str) -> None:
        # Un estado más grave nunca se rebaja.
        order = [Status.OK, Status.DUDOSO, Status.PENDIENTE, Status.CONTRADICTORIO]
        if order.index(status) > order.index(self.status):
            self.status = status
        self.notes.append(note)


@dataclass
class ExtractedDocument:
    """Resultado de extraer un documento (una o varias páginas)."""
    format_id: str | None
    format_score: float
    fields: dict[str, FieldValue] = field(default_factory=dict)
    lines: list[dict[str, FieldValue]] = field(default_factory=list)  # varios residuos
    pages: list[int] = field(default_factory=list)
    source_file: str | None = None
    file_sha256: str | None = None
    warnings: list[str] = field(default_factory=list)

    def get(self, key: str) -> FieldValue:
        return self.fields.setdefault(key, FieldValue.missing())
