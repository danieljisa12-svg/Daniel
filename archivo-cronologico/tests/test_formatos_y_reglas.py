from decimal import Decimal

import pytest

from hj_archivo.catalogs import load_catalogs
from hj_archivo.extraction import Line, extract_fields
from hj_archivo.formats import FormatError, detect_format, load_formats, parse_format
from hj_archivo.models import Status


@pytest.fixture(scope="module")
def formats():
    return load_formats()


def lines(text):
    return [Line(t) for t in text.splitlines() if t.strip()]


def test_formatos_cargan(formats):
    assert {f.id for f in formats} == {"hj_carta_porte", "recytrack_di"}


def test_deteccion(formats, hj_text, recy_text):
    assert detect_format(hj_text, formats).format.id == "hj_carta_porte"
    assert detect_format(recy_text, formats).format.id == "recytrack_di"
    assert detect_format("Factura de suministro eléctrico", formats).format is None


def test_deteccion_tolera_errores_ocr(formats, recy_text):
    noisy = recy_text.replace("RECYTRACK", "RECYTRAK").replace("IDENTIFICACIÓN", "IDENTIFICACI0N")
    assert detect_format(noisy, formats).format.id == "recytrack_di"


def test_formato1_peso_real_no_estimado(formats, hj_text):
    fmt = next(f for f in formats if f.id == "hj_carta_porte")
    doc = extract_fields(lines(hj_text), fmt, load_catalogs())
    assert doc.fields["kilos_estimados"].value.kg == Decimal(8500)
    assert doc.fields["kilos_reales"].value.kg == Decimal(11440)
    q = doc.fields["cantidad_recibida"]
    assert q.value.kg == Decimal(11440) and q.status == Status.OK
    assert any("+2940" in n for n in q.notes)
    assert doc.fields["di"].value == "HJ-2026-000123"
    assert doc.fields["codigo_ler"].value == "17 01 07"
    assert doc.fields["tratamiento"].value == "R5"
    assert doc.fields["cliente_nombre"].value == "Construcciones Pérez S.A."  # conserva tildes
    assert doc.fields["fecha_traslado"].value.isoformat() == "2026-11-14"
    # Sin ticket en el documento → pendiente, nunca inventado
    assert doc.fields["numero_ticket"].value is None
    assert doc.fields["numero_ticket"].status == Status.PENDIENTE
    # Sello / firma nunca equivalen a aceptación
    assert doc.fields["aceptacion"].value is None


def test_formato1_sin_peso_real_no_usa_estimado(formats, hj_text):
    fmt = next(f for f in formats if f.id == "hj_carta_porte")
    txt = "\n".join(l for l in hj_text.splitlines() if "reales" not in l)
    q = extract_fields(lines(txt), fmt).fields["cantidad_recibida"]
    assert q.value is None and q.status == Status.PENDIENTE


def test_formato2_peso_de_aceptacion(formats, recy_text):
    fmt = next(f for f in formats if f.id == "recytrack_di")
    doc = extract_fields(lines(recy_text), fmt, load_catalogs())
    assert doc.fields["cantidad_estimada"].value.kg == Decimal(3500)
    assert doc.fields["cantidad_aceptada"].value.kg == Decimal(4340)
    assert doc.fields["cantidad_recibida"].value.kg == Decimal(4340)
    # Mismas etiquetas en secciones distintas → valores distintos
    assert doc.fields["origen_nima"].value == "2800099999"
    assert doc.fields["destino_nima"].value == "2800011111"
    assert doc.fields["transportista_nombre"].value == "Hermanos Jiménez 2004 S.L."
    assert doc.fields["operador_inscripcion"].value == "G28/000123"
    assert doc.fields["fecha_aceptacion"].value.isoformat() == "2026-11-15"
    # Tratamiento vacío en el documento → pendiente
    assert doc.fields["tratamiento"].value is None
    assert doc.fields["tratamiento"].status == Status.PENDIENTE
    assert doc.fields["numero_ticket"].value is None


def test_baja_confianza_marca_dudoso(formats, hj_text):
    fmt = next(f for f in formats if f.id == "hj_carta_porte")
    ls = [Line(t, 0.55 if "reales" in t else 0.95) for t in hj_text.splitlines() if t.strip()]
    doc = extract_fields(ls, fmt)
    assert doc.fields["cantidad_recibida"].status == Status.DUDOSO


def test_valores_contradictorios(formats, hj_text):
    fmt = next(f for f in formats if f.id == "hj_carta_porte")
    doc = extract_fields(lines(hj_text + "\nKilos reales: 12.000 kg\n"), fmt)
    assert doc.fields["kilos_reales"].status == Status.CONTRADICTORIO


def test_formato_invalido_se_rechaza():
    with pytest.raises(FormatError):
        parse_format({"id": "x", "nombre": "x", "deteccion": {}, "campos": {"a": {"tipo": "peso"}},
                      "reglas": {"cantidad_recibida": {"usar": "a", "nunca": ["a"]}}})
    with pytest.raises(FormatError):
        parse_format({"id": "x", "nombre": "x", "deteccion": {}, "campos": {"a": {"tipo": "inventado"}}})
