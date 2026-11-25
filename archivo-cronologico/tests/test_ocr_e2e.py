"""Prueba de extremo a extremo del OCR local sobre un escaneo SINTÉTICO renderizado.

Verifica la tubería real (orientación, inclinación, Tesseract, detección y reglas). No
sustituye la validación con documentos reales (fase 2)."""
import shutil
from decimal import Decimal

import pytest
from PIL import Image, ImageDraw, ImageFont

from hj_archivo.catalogs import load_catalogs
from hj_archivo.extraction import extract_fields
from hj_archivo.formats import detect_format, load_formats
from hj_archivo.reader import read_document

pytestmark = pytest.mark.skipif(shutil.which("tesseract") is None, reason="Tesseract no instalado")
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def render(text, path, rotate=0, skew=0.0):
    img = Image.new("L", (2480, 3508), 255)  # A4 a 300 ppp
    d = ImageDraw.Draw(img)
    f = ImageFont.truetype(FONT, 42)
    y = 150
    for line in text.splitlines():
        d.text((150, y), line, font=f, fill=0)
        y += 70
    if skew:
        img = img.rotate(skew, expand=False, fillcolor=255, resample=Image.BICUBIC)
    if rotate:
        img = img.rotate(rotate, expand=True, fillcolor=255)
    img.save(path)
    return path


@pytest.mark.parametrize("rotate,skew", [(0, 0.0), (0, 1.5), (180, 0.0)])
def test_ocr_formato2(tmp_path, recy_text, rotate, skew):
    p = render(recy_text, tmp_path / "scan.png", rotate, skew)
    pages = read_document(p)
    lines = [ln for pg in pages for ln in pg.lines]
    det = detect_format("\n".join(l.text for l in lines), load_formats())
    assert det.format and det.format.id == "recytrack_di"
    doc = extract_fields(lines, det.format, load_catalogs())
    assert doc.fields["cantidad_recibida"].value.kg == Decimal(4340)
    assert doc.fields["cantidad_recibida"].source.value == "ocr"
    assert doc.fields["codigo_ler"].value == "17 09 04"


def test_pdf_con_capa_de_texto(tmp_path, hj_text):
    fitz = pytest.importorskip("fitz")
    pdf = fitz.open()
    page = pdf.new_page()
    page.insert_text((50, 60), hj_text, fontsize=9)
    p = tmp_path / "doc.pdf"
    pdf.save(p)
    pages = read_document(p)
    assert pages[0].method == "pdf_texto"
    lines = [ln for pg in pages for ln in pg.lines]
    fmt = detect_format("\n".join(l.text for l in lines), load_formats()).format
    assert fmt.id == "hj_carta_porte"
    assert extract_fields(lines, fmt).fields["cantidad_recibida"].value.kg == Decimal(11440)
