from hj_archivo import schema
from hj_archivo.spreadsheet.inspect import analyze

from conftest import build_ods


def _row(numero, di, as_float=False):
    r = [(None, None)] * 26
    r[0] = (numero, "float")
    r[3] = (di, "float" if as_float else "string")
    r[21] = ("11440", "float")
    return r


def test_ods_estructura_correcta(tmp_path):
    p = build_ods(tmp_path / "x.ods", schema.EXPECTED_HEADERS, [_row("1", "DI-001"), _row("2", "DI-002")])
    rep = analyze(p)
    assert rep.target_found and rep.header_problems == []
    assert rep.data_rows == 2 and rep.last_data_row == 7 and rep.next_free_row == 8
    assert rep.numero_pattern.startswith("enteros correlativos")
    assert rep.filters and "A5" in rep.filters[0]
    assert {s["nombre"] for s in rep.sheets} == {"AGENTE_Y_TRANSPORTISTA", "OTRA"}


def test_ods_detecta_riesgos(tmp_path):
    hdr = list(schema.EXPECTED_HEADERS)
    hdr[4] = "CODIGO  LER"
    p = build_ods(tmp_path / "x.ods", hdr, [_row("1", "2.80001234520261E+21", True), _row("3", "2.80001234520261E+21", True)])
    rep = analyze(p)
    assert any(x.startswith("E:") for x in rep.header_problems)
    assert rep.precision_risks and rep.duplicate_di
    assert "no correlativos" in rep.numero_pattern


def test_hoja_ausente(tmp_path):
    p = build_ods(tmp_path / "x.ods", schema.EXPECTED_HEADERS, [], sheet="Hoja1")
    assert not analyze(p).target_found


def test_inspeccion_no_modifica(tmp_path):
    from hj_archivo.reader import sha256_file
    p = build_ods(tmp_path / "x.ods", schema.EXPECTED_HEADERS, [_row("1", "DI-001")])
    h = sha256_file(p)
    analyze(p)
    assert sha256_file(p) == h
