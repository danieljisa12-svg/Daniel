# Fase 1 – Análisis y reglas de extracción

## 1. Estado de los archivos de referencia

**PRUEBA.ods y las fotografías de los documentos no se han recibido.** No están en el
repositorio ni en ninguna carpeta del equipo conectada a la sesión. Por eso este
documento separa con claridad:

- **Hechos de la especificación**: estructura de columnas, ejemplos de pesos, reglas
  de negocio. Ya están programados y cubiertos por pruebas.
- **Hipótesis pendientes** (marcadas «H»): requieren ver los archivos reales. Ninguna se
  usa para escribir en el archivo cronológico hasta confirmarse.

Al recibir los archivos, el análisis se ejecuta con una orden (ver §6), sin modificar
los originales.

## 2. Archivo cronológico (hecho de la especificación)

| Elemento | Valor |
|---|---|
| Hoja | `AGENTE_Y_TRANSPORTISTA` |
| Fila de cabeceras | 5 |
| Primera fila de datos | 6 |
| Columnas | A–Z (26), cabeceras exactas en `src/hj_archivo/schema.py` |

Reglas de escritura derivadas:

- Las cabeceras se comparan carácter a carácter (tildes, sufijos «2», «3», «4»… y
  espacios). Si no coinciden, no se escribe.
- DI, NIMA, NIF, ticket, código LER, inscripciones y NUMERO se tratan como **texto**
  para evitar pérdida de ceros iniciales y notación científica. El inspector detecta
  identificadores ya guardados como número (p. ej. `2.80001234520261E+21`).
- Para ODS se manipulará `content.xml` directamente (lxml): solo se insertan filas
  nuevas; estilos, filtros, fórmulas y demás hojas quedan byte a byte intactos. Para
  XLSX se usará openpyxl (limitación conocida: puede descartar gráficos o imágenes
  incrustadas; el inspector lo comprobará antes de habilitar XLSX).

### Hipótesis sobre columnas

- **H1** – Bloques de entidades: G–K = productor/origen; L–P = gestor/instalación de
  destino; Q–T = transportista (sin dirección). Se deduce del orden y de que Q–T no
  tiene dirección. **Confirmar con registros existentes.**
- **H2** – Unidad de V (CANTIDAD RECIBIDA): kg o t. **Confirmar.**
- **H3** – Formato de C, W, X: fecha real de hoja de cálculo o texto. **Confirmar.**
- **H4** – A (NUMERO): correlativo. El inspector informa si los existentes son enteros
  correlativos; la regla final la decide el usuario.

## 3. Formato 1 – Documento Identificativo y Carta de Porte (Hermanos Jiménez)

Definición: `config/formatos/hj_carta_porte.yaml` (estado **borrador**).

| Dato | Regla |
|---|---|
| Detección | Contiene «CARTA DE PORTE»; refuerzan «DOCUMENTO IDENTIFICATIVO», «HERMANOS JIMENEZ», «KILOS ESTIMADOS/REALES». Excluye «RECYTRACK». Tolerante a errores de OCR. |
| Cantidad recibida (V) | **Kilos reales**. Nunca kilos estimados, ni siquiera como sustituto: si faltan los reales, V queda pendiente. Ejemplo: 8.500 estimados / 11.440 reales → **11.440 kg**. La diferencia se anota para revisión. |
| Instalación de destino | Opción marcada con X → detección de casillas (fase 2) sobre las opciones reales del impreso (pendientes de ver). |
| Sello inferior | Texto del sello por OCR de la región (fase 2); se usa para comprobar la coherencia con el destino marcado. |
| Aceptación (Y) | **Nunca se deduce** de firma o sello sin regla aprobada por el usuario. Queda pendiente. |
| Ticket (B) | Solo si aparece en el documento (posible en el sello). Nunca inventado. |

## 4. Formato 2 – Documento de Identificación de Residuos RECYTRACK

Definición: `config/formatos/recytrack_di.yaml` (estado **borrador**).

Apartados reconocidos como secciones: Operador del traslado · Origen del traslado ·
Destino del traslado · Características del residuo · Transportista · Datos de
aceptación o rechazo. Las mismas etiquetas (Razón social, NIF, NIMA…) se interpretan
según la sección en la que aparecen.

| Dato | Regla |
|---|---|
| Cantidad recibida (V) | Peso del apartado **Aceptación o rechazo**. El de Características es orientativo y nunca sustituye. Ejemplo: 3.500 / 4.340 → **4.340 kg**. |
| Ticket (B) | No se inventa si no aparece. |
| Tratamiento (U) | Si está vacío → pendiente, salvo regla autorizada y verificada. |

## 5. Principios comunes (programados)

1. **Nunca se inventa un valor.** Sin evidencia → vacío y `pendiente`.
2. Cada campo guarda: valor, texto original, confianza, origen (texto PDF, OCR, QR,
   casilla, sello, base de datos, regla, usuario) y página.
3. Confianza de OCR < 80 % → `dudoso`. Dos valores distintos para el mismo campo →
   `contradictorio`.
4. Pesos: «11.440» con punto de miles = 11 440; sin unidad **no se asume** kg ni t;
   valores > 60 000 kg se marcan (confusión kg/t o separadores).
5. Fechas siempre día/mes/año; fechas imposibles o futuras se marcan.
6. NIF/CIF/NIE con dígito de control; NIMA de 10 dígitos con provincia 01–52; LER
   normalizado «17 01 07», con aviso si el asterisco de peligrosidad no cuadra con el
   catálogo.
7. La descripción interna de la columna F **no** se toma del catálogo LER: se usará una
   tabla de equivalencias configurada con la empresa.

## 6. Cómo completar el análisis con los archivos reales

1. Copiar PRUEBA.ods, fotografías y PDF en `archivo-cronologico/referencias/`
   (carpeta excluida de Git).
2. Ejecutar `python tools/analizar_referencias.py referencias/ --salida informes/`.
3. El informe JSON contiene: cabeceras encontradas y discrepancias, siguiente fila
   libre, tipos y estilos por columna, fórmulas, filtros, DI duplicados, patrón de
   NUMERO, riesgos de precisión y, por cada documento, texto OCR, QR, formato
   detectado y campos extraídos con su estado.
4. Con ese informe se ajustan las etiquetas de los YAML, se confirman H1–H4 y los
   formatos pasan a estado `validado`.
