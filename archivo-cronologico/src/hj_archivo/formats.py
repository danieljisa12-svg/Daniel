"""Carga de definiciones de formato (YAML) y detección del formato de un documento.

Un formato nuevo se incorpora añadiendo un archivo a ``config/formatos/`` sin tocar
este módulo.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from .text import fuzzy_contains, norm

CONFIG_DIR = Path(__file__).resolve().parents[2] / "config"
VALID_TYPES = {"di", "fecha", "texto", "nif", "nima", "ler", "peso", "operacion", "ticket", "casilla", "sello"}


@dataclass
class FieldDef:
    key: str
    type: str
    labels: list[str] = field(default_factory=list)
    section: str | None = None
    pattern: str | None = None
    options: list[str] = field(default_factory=list)


@dataclass
class FormatDef:
    id: str
    name: str
    status: str
    required: list[str]
    indicative: list[str]
    excluding: list[str]
    threshold: float
    sections: list[dict[str, Any]]
    fields: dict[str, FieldDef]
    rules: dict[str, Any]
    examples: list[dict[str, Any]]
    path: Path | None = None


class FormatError(ValueError):
    pass


def parse_format(data: dict[str, Any], path: Path | None = None) -> FormatDef:
    for k in ("id", "nombre", "deteccion", "campos"):
        if k not in data:
            raise FormatError(f"{path}: falta la clave obligatoria '{k}'")
    det = data["deteccion"]
    fields: dict[str, FieldDef] = {}
    section_ids = {s["id"] for s in data.get("secciones", [])}
    for key, spec in data["campos"].items():
        t = spec.get("tipo")
        if t not in VALID_TYPES:
            raise FormatError(f"{path}: campo '{key}' con tipo no válido {t!r}")
        sec = spec.get("seccion")
        if sec is not None and sec not in section_ids:
            raise FormatError(f"{path}: campo '{key}' referencia la sección inexistente {sec!r}")
        fields[key] = FieldDef(key, t, list(spec.get("etiquetas", [])), sec, spec.get("patron"), list(spec.get("opciones", [])))
    rules = data.get("reglas", {})
    qty = rules.get("cantidad_recibida", {})
    if qty.get("usar") and qty["usar"] not in fields:
        raise FormatError(f"{path}: la regla cantidad_recibida usa un campo inexistente")
    if qty.get("usar") in qty.get("nunca", []):
        raise FormatError(f"{path}: la regla cantidad_recibida usa un campo prohibido")
    return FormatDef(
        id=data["id"], name=data["nombre"], status=data.get("estado", "borrador"),
        required=list(det.get("obligatorias", [])), indicative=list(det.get("indicativas", [])),
        excluding=list(det.get("excluyentes", [])), threshold=float(det.get("umbral", 0.6)),
        sections=list(data.get("secciones", [])), fields=fields, rules=rules,
        examples=list(data.get("ejemplos_referencia", [])), path=path,
    )


def load_formats(directory: Path | None = None) -> list[FormatDef]:
    directory = directory or CONFIG_DIR / "formatos"
    out = []
    for p in sorted(directory.glob("*.yaml")):
        with open(p, encoding="utf-8") as f:
            out.append(parse_format(yaml.safe_load(f), p))
    ids = [f.id for f in out]
    if len(ids) != len(set(ids)):
        raise FormatError("Hay identificadores de formato repetidos")
    return out


@dataclass
class Detection:
    format: FormatDef | None
    score: float
    scores: dict[str, float]


def score_format(fmt: FormatDef, text_norm: str) -> float:
    for ex in fmt.excluding:
        if fuzzy_contains(text_norm, ex, 0.9):
            return 0.0
    for req in fmt.required:
        if not fuzzy_contains(text_norm, req):
            return 0.0
    if not fmt.indicative:
        return 1.0
    hits = sum(fuzzy_contains(text_norm, k) for k in fmt.indicative)
    return 0.4 + 0.6 * hits / len(fmt.indicative)


def detect_format(text: str, formats: list[FormatDef]) -> Detection:
    """Devuelve el formato con mayor puntuación si supera su umbral.

    Si dos formatos superan el umbral con puntuación muy similar, no se elige
    ninguno: el documento va a revisión manual.
    """
    tn = norm(text)
    scores = {f.id: score_format(f, tn) for f in formats}
    ranked = sorted(formats, key=lambda f: scores[f.id], reverse=True)
    if not ranked or scores[ranked[0].id] < ranked[0].threshold:
        return Detection(None, scores[ranked[0].id] if ranked else 0.0, scores)
    if len(ranked) > 1 and scores[ranked[1].id] >= ranked[1].threshold and scores[ranked[0].id] - scores[ranked[1].id] < 0.1:
        return Detection(None, scores[ranked[0].id], scores)
    return Detection(ranked[0], scores[ranked[0].id], scores)
