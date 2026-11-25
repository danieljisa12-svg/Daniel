"""FASE 1 – Análisis de los archivos de referencia (solo lectura).

Uso:
    python tools/analizar_referencias.py <carpeta_o_archivo> [--salida informes/]

Para cada archivo:
  * ODS/XLSX: estructura de AGENTE_Y_TRANSPORTISTA (cabeceras, filas, tipos, estilos,
    fórmulas, filtros, riesgos de precisión, DI duplicados, patrón de NUMERO).
  * PDF/imagen: texto (capa PDF u OCR local), QR, formato detectado y campos
    extraídos con el motor de reglas.

Garantía: se calcula la huella SHA-256 de cada original antes y después; el análisis
se hace sobre una copia temporal y el programa termina con error si un original
cambiase. El informe completo se guarda en la carpeta de salida (excluida de Git
porque contiene datos de clientes).
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from dataclasses import asdict, is_dataclass
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from hj_archivo.catalogs import load_catalogs  # noqa: E402
from hj_archivo.extraction import extract_fields  # noqa: E402
from hj_archivo.formats import detect_format, load_formats  # noqa: E402
from hj_archivo.reader import IMAGE_EXT, read_document, sha256_file  # noqa: E402
from hj_archivo.spreadsheet.inspect import analyze  # noqa: E402

SHEET_EXT = {".ods", ".xlsx", ".xlsm"}


def _json_default(o):
    if is_dataclass(o):
        return asdict(o)
    if isinstance(o, (date, datetime)):
        return o.isoformat()
    if isinstance(o, Decimal):
        return str(o)
    if hasattr(o, "value"):
        return o.value
    return str(o)


def analyze_document(path: Path, formats, catalogs) -> dict:
    pages = read_document(path)
    lines = [ln for p in pages for ln in p.lines]
    text = "\n".join(ln.text for ln in lines)
    det = detect_format(text, formats)
    out = {
        "paginas": [{"pagina": p.page, "metodo": p.method, "rotacion": p.rotation, "inclinacion": round(p.skew_deg, 2),
                     "lineas": len(p.lines), "qr": p.qr} for p in pages],
        "texto": text,
        "puntuaciones_formato": det.scores,
        "formato": det.format.id if det.format else None,
    }
    if det.format:
        doc = extract_fields(lines, det.format, catalogs)
        out["campos"] = {k: {"valor": fv.value, "estado": fv.status.value, "confianza": round(fv.confidence, 2),
                             "origen": fv.source.value if fv.source else None, "texto_original": fv.raw_text,
                             "notas": fv.notes} for k, fv in doc.fields.items()}
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("entrada", type=Path)
    ap.add_argument("--salida", type=Path, default=Path("informes"))
    a = ap.parse_args(argv)

    files = [a.entrada] if a.entrada.is_file() else sorted(p for p in a.entrada.rglob("*") if p.is_file())
    files = [p for p in files if p.suffix.lower() in SHEET_EXT | IMAGE_EXT | {".pdf"}]
    if not files:
        print("No se encontraron archivos ODS/XLSX/PDF/imagen para analizar.")
        return 1
    before = {p: sha256_file(p) for p in files}
    formats, catalogs = load_formats(), load_catalogs()
    report: dict = {"generado": datetime.now().isoformat(timespec="seconds"), "archivos": {}}

    with tempfile.TemporaryDirectory(prefix="hj_analisis_") as tmp:
        for p in files:
            copy = Path(tmp) / f"{before[p][:12]}{p.suffix.lower()}"
            shutil.copy2(p, copy)
            entry: dict = {"sha256": before[p]}
            try:
                if p.suffix.lower() in SHEET_EXT:
                    entry["hoja_calculo"] = analyze(copy)
                else:
                    entry["documento"] = analyze_document(copy, formats, catalogs)
            except Exception as e:  # se informa y se continúa con el resto
                entry["error"] = f"{type(e).__name__}: {e}"
            report["archivos"][p.name] = entry
            print(f"✓ {p.name}" if "error" not in entry else f"✗ {p.name}: {entry['error']}")

    changed = [p.name for p in files if sha256_file(p) != before[p]]
    a.salida.mkdir(parents=True, exist_ok=True)
    out = a.salida / f"analisis_{datetime.now():%Y%m%d_%H%M%S}.json"
    out.write_text(json.dumps(report, default=_json_default, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nInforme: {out}")
    if changed:
        print("ERROR: los originales siguientes han cambiado durante el análisis:", ", ".join(changed))
        return 2
    print("Originales verificados: ninguna huella SHA-256 ha cambiado.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
