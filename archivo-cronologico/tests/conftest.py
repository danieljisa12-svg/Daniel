"""Fixtures SINTÉTICOS. No son copias de documentos reales: reproducen únicamente los
datos citados en la especificación (8.500/11.440 kg y 3.500/4.340 kg) para fijar las
reglas de negocio. Se sustituirán por casos derivados de los documentos reales."""
import zipfile
from pathlib import Path

import pytest

HJ_TEXT = """HERMANOS JIMÉNEZ 2004 S.L.
DOCUMENTO IDENTIFICATIVO Y CARTA DE PORTE
Nº DI: HJ-2026-000123        Fecha de traslado: 14/11/2026
OPERADOR
Razón social: Hermanos Jiménez 2004 S.L.   NIF: B12345674   NIMA: 2800012345
ORIGEN / CLIENTE
Razón social: Construcciones Pérez S.A.   NIF: A12345674
Dirección de la obra: C/ Mayor 12, Móstoles
RESIDUO
Código LER: 17 01 07
Descripción del residuo: Mezclas de hormigón y ladrillos
Kilos estimados: 8.500 kg
Kilos reales: 11.440 kg
Tratamiento: R5
Fecha de entrega: 14/11/2026
"""

RECY_TEXT = """RECYTRACK
DOCUMENTO DE IDENTIFICACIÓN DE RESIDUOS
Nº DI: DI28000123452026000456
OPERADOR DEL TRASLADO
Razón social: Gestora Ejemplo S.L.
NIF: B12345674
NIMA: 2800012345
Nº inscripción: G28/000123
ORIGEN DEL TRASLADO
Razón social: Promociones Norte S.L.
Dirección: Avda. Sur 5, Getafe
NIF: A12345674
NIMA: 2800099999
DESTINO DEL TRASLADO
Razón social: Planta de Reciclaje Ejemplo S.L.
Dirección: Ctra. M-50 km 3
NIF: B12345674
NIMA: 2800011111
Operación de tratamiento:
CARACTERÍSTICAS DEL RESIDUO
Código LER: 17 09 04
Descripción: Residuos mezclados de construcción y demolición
Cantidad: 3.500 kg
TRANSPORTISTA
Razón social: Hermanos Jiménez 2004 S.L.
NIF: B12345674
NIMA: 2800012345
DATOS DE ACEPTACIÓN O RECHAZO
Cantidad recibida: 4.340 kg
Fecha de aceptación: 15/11/2026
"""


@pytest.fixture
def hj_text():
    return HJ_TEXT


@pytest.fixture
def recy_text():
    return RECY_TEXT


def _cell(v=None, vt="string", style=None):
    if v is None:
        return '<table:table-cell/>'
    st = f' table:style-name="{style}"' if style else ""
    if vt == "float":
        return f'<table:table-cell office:value-type="float" office:value="{v}"{st}><text:p>{v}</text:p></table:table-cell>'
    return f'<table:table-cell office:value-type="string"{st}><text:p>{v}</text:p></table:table-cell>'


def build_ods(path: Path, headers, data_rows, sheet="AGENTE_Y_TRANSPORTISTA"):
    rows = []
    rows.append("<table:table-row>" + _cell("ARCHIVO CRONOLÓGICO") + "</table:table-row>")
    rows.append('<table:table-row table:number-rows-repeated="3"><table:table-cell table:number-columns-repeated="26"/></table:table-row>')
    rows.append("<table:table-row>" + "".join(_cell(h, style="hdr") for h in headers) + "</table:table-row>")
    for r in data_rows:
        rows.append("<table:table-row>" + "".join(_cell(v, vt) for v, vt in r) + "</table:table-row>")
    rows.append('<table:table-row table:number-rows-repeated="1048000"><table:table-cell table:number-columns-repeated="1024"/></table:table-row>')
    content = f'''<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3">
<office:body><office:spreadsheet>
<table:table table:name="{sheet}">{''.join(rows)}</table:table>
<table:table table:name="OTRA"><table:table-row><table:table-cell/></table:table-row></table:table>
<table:database-ranges><table:database-range table:name="__Anonymous_Sheet_DB__0" table:target-range-address="{sheet}.A5:{sheet}.Z7" table:display-filter-buttons="true"/></table:database-ranges>
</office:spreadsheet></office:body></office:document-content>'''
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/vnd.oasis.opendocument.spreadsheet")
        z.writestr("content.xml", content)
        z.writestr("META-INF/manifest.xml", '<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"/>')
    return path
