# Registro de cambios

## [0.1.0] – 2026-11-25 – Fase 1

### Añadido
- Esquema de las 26 columnas de `AGENTE_Y_TRANSPORTISTA` y validación estricta de cabeceras.
- Validadores de NIF/CIF/NIE, NIMA, LER, pesos (kg/t), fechas, DI y ticket.
- Definiciones de formato en YAML (Carta de Porte HJ y RECYTRACK, en borrador) y motor de extracción.
- Lectura local de PDF y OCR (Tesseract) con corrección de orientación e inclinación y lectura de QR.
- Inspector de solo lectura de ODS/XLSX y herramienta `tools/analizar_referencias.py`.
- 45 pruebas automatizadas.
