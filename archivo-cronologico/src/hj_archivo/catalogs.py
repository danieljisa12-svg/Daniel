"""Carga de catálogos de referencia (LER, operaciones de tratamiento)."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

from .formats import CONFIG_DIR


@lru_cache(maxsize=4)
def load_catalogs(directory: str | None = None) -> dict:
    d = Path(directory) if directory else CONFIG_DIR / "catalogos"
    with open(d / "ler.yaml", encoding="utf-8") as f:
        ler = yaml.safe_load(f)
    with open(d / "operaciones.yaml", encoding="utf-8") as f:
        ops = yaml.safe_load(f)
    return {"ler": ler, "operaciones": ops}
