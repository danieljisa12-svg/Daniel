# Arquitectura técnica

## Tecnologías

| Área | Elección | Motivo |
|---|---|---|
| Lenguaje | Python 3.11+ | Ecosistema OCR/visión maduro; empaquetable para Windows. |
| PDF | PyMuPDF | Capa de texto exacta y renderizado a 300 ppp sin dependencias externas. |
| OCR | Tesseract 5 (`spa`), local | Gratuito, sin envío de datos. Orientación con OSD. |
| Visión | OpenCV | Inclinación, contraste, casillas, regiones de sello, QR (detector integrado). |
| Hoja de cálculo | lxml sobre `content.xml` (ODS) · openpyxl (XLSX) | ODS: cambios mínimos y verificables sin alterar estilos ni filtros. |
| Base de datos | SQLite (fase 3) | Local, sin servidor, con copias simples. |
| Monitorización | watchdog + comprobación de tamaño estable (fase 6) | Compatible con carpetas SMB del Ricoh. |
| Interfaz | PySide6 / Qt (fase 5) | Nativa en Windows, visor de documentos y formularios. |
| Instalador | PyInstaller + Inno Setup (fase 8) | Ejecutable con Tesseract incluido y acceso directo. |
| IA externa | Opcional, desactivada por defecto (fase 2+) | Solo con autorización expresa y clave guardada en el almacén de Windows. |

## Módulos (estado actual)

```
src/hj_archivo/
  schema.py        26 columnas, fila 5/6, comparación exacta de cabeceras   [hecho]
  models.py        FieldValue con valor, texto original, confianza, origen    [hecho]
  validators.py    NIF/CIF/NIE, NIMA, LER, pesos kg/t, fechas, DI, ticket     [hecho]
  text.py          normalización tolerante a OCR                             [hecho]
  formats.py       carga de YAML y detección de formato                      [hecho]
  extraction.py    secciones + etiquetas + reglas de negocio                 [hecho]
  reader.py        texto PDF, OCR, orientación, inclinación, contraste, QR    [hecho]
  catalogs.py      LER y operaciones R/D                                     [hecho]
  spreadsheet/inspect.py  inspección de solo lectura ODS/XLSX                [hecho]
  vision.py        casillas marcadas, sellos, separación de documentos       [fase 2]
  db/              SQLite, maestros, historial                               [fase 3]
  spreadsheet/writer.py  escritura segura con copia y verificación           [fase 4]
  ui/              interfaz Qt                                               [fase 5]
  watcher.py       carpeta de escaneos y flujo de carpetas                   [fase 6]
```

## Flujo de datos

```
Ricoh (SMB) → Pendientes → Procesando → lectura (PDF/OCR/QR) → detección de formato
  → extracción por reglas YAML → validación → duplicados → Revisar (pantalla)
  → aprobación del lote → copia de seguridad → escritura → verificación → Procesados
```
