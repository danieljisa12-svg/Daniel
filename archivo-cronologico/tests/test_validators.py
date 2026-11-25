from decimal import Decimal

import pytest

from hj_archivo import validators as v


@pytest.mark.parametrize("nif,kind", [("12345678Z", "DNI"), ("X1234567L", "NIE"), ("B12345674", "CIF"),
                                      ("b-1234567-4", "CIF"), ("P1234567D", "CIF"), ("ESB12345674", "CIF")])
def test_nif_validos(nif, kind):
    c = v.validate_nif(nif)
    assert c.ok and c.kind == kind


@pytest.mark.parametrize("nif", ["12345678A", "X1234567A", "B12345675", "P12345674", "1234", ""])
def test_nif_invalidos(nif):
    assert not v.validate_nif(nif).ok


def test_nima():
    assert v.validate_nima("2800012345").value == "2800012345"
    assert v.validate_nima("0800012345").value == "0800012345"  # conserva el cero inicial
    assert not v.validate_nima("280001234").ok
    assert not v.validate_nima("0000012345").ok
    assert not v.validate_nima("9900012345").ok


def test_ler():
    assert v.normalize_ler("170107").value == "17 01 07"
    assert v.normalize_ler("17.06.05*").value == "17 06 05*"
    assert v.normalize_ler("17-09-04").value == "17 09 04"
    cat = {"17 06 05*": {}, "17 01 07": {}}
    assert v.validate_ler("17 01 07", cat).ok
    c = v.validate_ler("17 06 05", cat)
    assert not c.ok and "asterisco" in c.message
    assert not v.validate_ler("99 01 01").ok


@pytest.mark.parametrize("raw,kg", [("11.440 kg", 11440), ("8.500 Kg", 8500), ("4.340 kgs", 4340),
                                     ("4,34 t", 4340), ("4,34 Tn", 4340), ("1.234,5 kg", Decimal("1234.5")),
                                     ("22 toneladas", 22000)])
def test_pesos(raw, kg):
    c = v.parse_weight(raw)
    assert c.ok, c.message
    assert c.value.kg == Decimal(kg)


def test_peso_sin_unidad_no_se_asume():
    c = v.parse_weight("11.440")
    assert not c.ok and "unidad" in c.message
    assert v.parse_weight("11.440", default_unit="kg").value.kg == 11440


def test_peso_ambiguo_y_fuera_de_rango():
    assert not v.parse_weight("4.34 kg").ok           # punto decimal dudoso
    assert not v.parse_weight("11.440 t").ok          # 11.440.000 kg: implausible


def test_fechas():
    assert v.parse_date("14/11/2026").value.isoformat() == "2026-11-14"
    assert v.parse_date("1-2-25").value.isoformat() == "2025-02-01"   # día/mes, nunca mes/día
    assert not v.parse_date("31/02/2026").ok
    assert not v.parse_date("01/01/2099").ok


def test_di_y_ticket():
    assert v.validate_di("HJ-2026-000123").ok
    assert not v.validate_di("").ok
    assert not v.validate_di("ABC123", pattern=r"DI\d+").ok
    assert not v.validate_ticket("").ok
