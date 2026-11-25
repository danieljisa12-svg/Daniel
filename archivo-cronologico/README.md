# Archivo cronológico – Hermanos Jiménez 2004 S.L.

Aplicación local para Windows que lee los documentos de identificación de residuos
escaneados con la Ricoh IM 370, extrae sus datos, los valida y, tras revisión humana,
los registra en la hoja `AGENTE_Y_TRANSPORTISTA` del archivo cronológico.

**Estado:** fase 1 (análisis y reglas). Aún no hay interfaz, instalador ni escritura
en el archivo. Ver [PROGRESO.md](PROGRESO.md).

## Desarrollo

```bash
pip install -r requirements.txt      # requiere Tesseract con idioma español
python -m pytest -q
python tools/analizar_referencias.py referencias/ --salida informes/
```

## Documentación

- [Fase 1: análisis y reglas de extracción](docs/fase1-analisis-y-reglas.md)
- [Decisiones pendientes con la empresa](docs/preguntas-pendientes.md)
- [Arquitectura](docs/arquitectura.md)
- [Registro de cambios](CHANGELOG.md)

## Privacidad

Todo el procesamiento es local. Los documentos de clientes no se suben al repositorio
(`referencias/`, `informes/` y bases de datos están excluidos en `.gitignore`).
