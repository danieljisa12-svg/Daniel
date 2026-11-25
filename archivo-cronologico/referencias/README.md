# Archivos de referencia

Coloque aquí **copias** de los archivos de referencia (PRUEBA.ods, fotografías y PDF de
los documentos). Esta carpeta está excluida de Git para no publicar datos de clientes.

Después ejecute:

    python tools/analizar_referencias.py referencias/ --salida informes/

La herramienta solo lee los archivos: comprueba la huella SHA-256 antes y después del
análisis y aborta si algún original hubiera cambiado.
