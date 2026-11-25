from hj_archivo import schema


def test_26_columnas_exactas():
    assert len(schema.COLUMNS) == 26
    assert [c.letter for c in schema.COLUMNS] == [chr(ord("A") + i) for i in range(26)]
    assert schema.COLUMN_BY_LETTER["V"].header == "CANTIDAD RECIBIDA"
    assert schema.COLUMN_BY_LETTER["L"].header == "NOMBRE/RAZÓN SOCIAL3"
    assert schema.COLUMN_BY_LETTER["P"].header == "Nº INSCRIPCION7"
    assert schema.HEADER_ROW == 5 and schema.FIRST_DATA_ROW == 6


def test_identificadores_como_texto():
    for k in ("numero_ticket", "di", "codigo_ler", "g_nif", "g_nima", "l_nima", "q_nima"):
        assert schema.COLUMN_BY_KEY[k].as_text


def test_comparacion_cabeceras():
    ok = list(schema.EXPECTED_HEADERS)
    assert schema.compare_headers(ok) == []
    bad = ok.copy()
    bad[5] = "DESCRIPCION CODIGO LER"
    bad[7] = "DIRECCIÓN "
    p = schema.compare_headers(bad)
    assert len(p) == 2 and p[0].startswith("F:") and "espacios" in p[1]
