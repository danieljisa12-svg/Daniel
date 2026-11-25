"""Lectura local de documentos: capa de texto del PDF, OCR (Tesseract) y QR.

Orden de preferencia por página:
1. Capa de texto nativa del PDF (exacta, confianza alta).
2. OCR local con Tesseract en español, tras corregir orientación e inclinación y
   mejorar el contraste.

Ningún contenido sale del equipo en este módulo.
"""
from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from .extraction import Line
from .models import Source

log = logging.getLogger(__name__)
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}
MIN_TEXT_CHARS = 80  # menos texto que esto en la capa PDF → se trata como escaneo


@dataclass
class PageResult:
    page: int
    method: str                      # 'pdf_texto' | 'ocr'
    lines: list[Line]
    rotation: int = 0
    skew_deg: float = 0.0
    qr: list[str] = field(default_factory=list)
    image: np.ndarray | None = None  # imagen normalizada (para casillas y sellos)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ------------------------------------------------------------------ imagen
def _to_gray(img: np.ndarray) -> np.ndarray:
    return img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def detect_orientation(gray: np.ndarray) -> int:
    """Grados (0/90/180/270) que hay que girar en sentido horario según Tesseract OSD."""
    import pytesseract

    try:
        osd = pytesseract.image_to_osd(gray, output_type=pytesseract.Output.DICT, config="--psm 0")
        return int(osd.get("rotate", 0)) % 360
    except Exception as e:  # OSD falla en páginas con poco texto
        log.debug("OSD no disponible: %s", e)
        return 0


def rotate(gray: np.ndarray, deg: int) -> np.ndarray:
    return {
        90: cv2.rotate(gray, cv2.ROTATE_90_CLOCKWISE),
        180: cv2.rotate(gray, cv2.ROTATE_180),
        270: cv2.rotate(gray, cv2.ROTATE_90_COUNTERCLOCKWISE),
    }.get(deg, gray)


def estimate_skew(gray: np.ndarray) -> float:
    """Inclinación estimada (grados) a partir de las líneas de texto (Hough)."""
    small = cv2.resize(gray, None, fx=0.5, fy=0.5) if gray.shape[1] > 2000 else gray
    bw = cv2.threshold(small, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    bw = cv2.dilate(bw, cv2.getStructuringElement(cv2.MORPH_RECT, (25, 1)))
    lines = cv2.HoughLinesP(bw, 1, np.pi / 720, threshold=200, minLineLength=small.shape[1] // 4, maxLineGap=20)
    if lines is None:
        return 0.0
    angles = []
    for x1, y1, x2, y2 in np.asarray(lines).reshape(-1, 4):
        a = np.degrees(np.arctan2(y2 - y1, x2 - x1))
        if abs(a) < 10:
            angles.append(a)
    return float(np.median(angles)) if angles else 0.0


def deskew(gray: np.ndarray, angle: float) -> np.ndarray:
    if abs(angle) < 0.2:
        return gray
    h, w = gray.shape
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(gray, m, (w, h), flags=cv2.INTER_CUBIC, borderValue=255)


def enhance(gray: np.ndarray) -> np.ndarray:
    """Contraste adaptativo y escalado si la resolución es baja (< ~200 ppp en A4)."""
    if gray.shape[1] < 1600:
        gray = cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return clahe.apply(gray)


def read_qr(img: np.ndarray) -> list[str]:
    det = cv2.QRCodeDetector()
    try:
        ok, texts, _, _ = det.detectAndDecodeMulti(img)
    except cv2.error:
        return []
    return [t for t in (texts if ok else []) if t]


def normalize_image(img: np.ndarray, auto_orient: bool = True) -> tuple[np.ndarray, int, float]:
    gray = _to_gray(img)
    rot = detect_orientation(gray) if auto_orient else 0
    gray = rotate(gray, rot)
    skew = estimate_skew(gray)
    gray = deskew(gray, skew)
    return enhance(gray), rot, skew


def ocr_lines(gray: np.ndarray, page: int, lang: str = "spa") -> list[Line]:
    """OCR con Tesseract agrupado por líneas, con confianza media por línea (0..1)."""
    import pytesseract

    d = pytesseract.image_to_data(gray, lang=lang, config="--psm 3", output_type=pytesseract.Output.DICT)
    groups: dict[tuple, list[tuple[str, float]]] = {}
    for i, word in enumerate(d["text"]):
        if not word.strip():
            continue
        key = (d["block_num"][i], d["par_num"][i], d["line_num"][i])
        groups.setdefault(key, []).append((word, float(d["conf"][i])))
    out = []
    for key in sorted(groups):
        words = groups[key]
        confs = [c for _, c in words if c >= 0]
        out.append(Line(" ".join(w for w, _ in words), (sum(confs) / len(confs) / 100) if confs else 0.0, page, Source.OCR))
    return out


# ------------------------------------------------------------------ documentos
def read_document(path: str | Path, dpi: int = 300, lang: str = "spa") -> list[PageResult]:
    path = Path(path)
    ext = path.suffix.lower()
    results: list[PageResult] = []
    if ext == ".pdf":
        import fitz  # PyMuPDF

        with fitz.open(path) as pdf:
            for i, pg in enumerate(pdf, start=1):
                text = pg.get_text("text") or ""
                pix = pg.get_pixmap(dpi=dpi)
                img = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)
                img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR if pix.n == 4 else cv2.COLOR_RGB2BGR) if pix.n >= 3 else img
                if len(text.strip()) >= MIN_TEXT_CHARS:
                    lines = [Line(t, 0.99, i, Source.PDF_TEXT) for t in text.splitlines() if t.strip()]
                    results.append(PageResult(i, "pdf_texto", lines, qr=read_qr(img), image=_to_gray(img)))
                else:
                    gray, rot, skew = normalize_image(img)
                    results.append(PageResult(i, "ocr", ocr_lines(gray, i, lang), rot, skew, read_qr(gray), gray))
    elif ext in IMAGE_EXT:
        img = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError(f"No se pudo abrir la imagen {path.name}")
        gray, rot, skew = normalize_image(img)
        results.append(PageResult(1, "ocr", ocr_lines(gray, 1, lang), rot, skew, read_qr(gray), gray))
    else:
        raise ValueError(f"Tipo de archivo no soportado: {ext}")
    return results
