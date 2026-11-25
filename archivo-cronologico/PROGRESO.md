# PROGRESO – Hermanos Jiménez · Automatización del archivo cronológico

Archivo vivo para continuar el desarrollo entre sesiones. Actualizar al cerrar cada
sesión.

## Estado por fases

| Fase | Estado | Notas |
|---|---|---|
| 1. Análisis y reglas | **Completada a falta de los archivos reales** | Reglas programadas y probadas; análisis real bloqueado (ver «Bloqueos»). |
| 2. Reconocimiento documental | Iniciada | Lectura PDF/OCR/orientación/inclinación/QR hecha. Falta: casillas, sellos, separación de documentos en PDF multipágina, varias líneas de residuo, IA opcional. |
| 3. Base de datos y validaciones | Validaciones hechas | Falta SQLite y maestros. |
| 4. Escritura segura | Pendiente | Solo existe el inspector de solo lectura. |
| 5. Interfaz | Pendiente | |
| 6. Monitorización de escaneos | Pendiente | |
| 7. Pruebas completas | Pendiente | 45 pruebas unitarias/e2e actuales. |
| 8. Instalador y documentación | Pendiente | |

## Bloqueos

1. **PRUEBA.ods y fotografías no recibidos.** No están en el repositorio. Colocar copias en
   `referencias/` y ejecutar `python tools/analizar_referencias.py referencias/`.
2. Decisiones de negocio: `docs/preguntas-pendientes.md` (NUMERO, ticket, unidad,
   equivalencias LER, inscripciones, aceptación).

## Hecho en la sesión 1 (2026-11-25)

- Estructura del proyecto `archivo-cronologico/`, dependencias, `.gitignore` que excluye
  documentos de clientes.
- Esquema exacto de las 26 columnas y comparación estricta de cabeceras.
- Modelo de datos con procedencia/confianza/estado por campo.
- Validadores: NIF/CIF/NIE (dígito de control), NIMA, LER, pesos kg/t con separadores
  españoles, fechas d/m/a, DI, ticket.
- Catálogos LER (cap. 17 y frecuentes) y operaciones R1–R13/D1–D15.
- Definiciones YAML de los formatos 1 y 2 (borrador) y motor genérico de secciones y
  etiquetas; reglas: peso real (F1), peso de aceptación (F2), ticket/tratamiento/
  aceptación nunca inventados.
- Lector local: texto PDF, OCR Tesseract, orientación OSD, inclinación, CLAHE, QR.
- Inspector ODS/XLSX de solo lectura y herramienta de análisis con verificación SHA-256.
- Pruebas: 45 (incluye OCR real sobre escaneos sintéticos girados 180° e inclinados).

## Próximos pasos

1. Con los archivos reales: ejecutar el análisis, ajustar etiquetas, confirmar H1–H4,
   pasar formatos a `validado`, convertir los documentos en casos de prueba
   (anonimizados) y registrar resultados aquí.
2. Fase 2: `vision.py` (casillas con X por densidad de píxeles en regiones definidas en
   YAML, región de sello, separación de documentos por detección de cabecera de formato).
3. Fase 3: esquema SQLite e importación verificada desde el cronológico.

## Entorno de desarrollo

- Python 3.13, Tesseract 5.3 con `spa`, OpenCV 5, PyMuPDF, lxml, openpyxl.
- Ejecutar pruebas: `cd archivo-cronologico && python -m pytest -q`.
