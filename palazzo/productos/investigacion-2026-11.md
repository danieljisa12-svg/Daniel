# Investigación de productos con venta real · España · 23/11/2026

## Cómo se ha hecho (y qué no)
- **Fuente principal:** el ranking oficial **"Los más vendidos" de Amazon.es**, leído hoy en 14 categorías. Amazon lo calcula a partir de sus ventas y lo actualiza cada hora. Es la señal pública más fiable de **venta real ahora mismo en España**. Los datos en bruto están en `datos/amazon-es-mas-vendidos-2026-11-23.json`.
- **Número de valoraciones:** indica cuánto ha vendido una ficha a lo largo del tiempo. No se confunde con las ventas actuales.
- **Datos que no se han podido obtener:**
  - **Unidades exactas.** Amazon no las publica, y el contador "comprados el mes pasado" y el precio se ocultan cuando se navega desde fuera de España.
  - **Google Trends.** Rechazó las consultas por límite de uso.
  - **Tablas de TikTok Shop España.** Se cargan desde un servicio externo, y FastMoss bloqueó las peticiones.
  - Por eso **no se da ninguna cifra de ventas inventada**.
- **Puntuación:** se ha calculado con `ops/src/commerce/scoring.js`. Los criterios y sus pesos están en `candidatos.json`.
- **Qué falta para pasar de candidato a producto publicable:** que el proveedor confirme coste, envío, plazos, devoluciones y documentación. Hasta entonces, todos los productos siguen como **candidato**.

## Resultado

| # | Producto | Prueba de venta real (Amazon.es, 23/11/2026) | Puntos | Por qué sí | Riesgo principal |
|---|---|---|---|---|---|
| 1 | **Calentador de manos recargable 2 en 1 magnético** (= Calora) | **Nº3 de todo Deportes y aire libre** y nº1 de su subcategoría | **84** | Es temporada alta. Ya tienes tema, fotos, vídeo y plan de anuncios. Es un buen regalo de Navidad | Batería de litio: CE, UN38.3 para el transporte, RAEE y pilas |
| 2 | **Luz LED magnética con sensor de movimiento**, en pack | **Nº1 de Iluminación**, con 5 fichas del mismo producto en el top 30 | 76 | Demanda enorme y constante. Ligera, sin tallas, con muy pocas devoluciones | Precio unitario bajo: hay que venderla **en pack de 3 o 6** para que el margen aguante la publicidad |
| 3 | **Proyector de estrellas / proyector de Navidad** | Nº3 y nº20 de Iluminación | 75 | Muy visual para TikTok y Reels, y buen regalo | Estacional. Es eléctrico (CE) |
| 4 | **Compresor de aire portátil / inflador de ruedas** | Nº6 de Coche y moto, a 23,26 € | 73 | Se demuestra muy bien en vídeo. Regalo para conductores. Encaja con la línea Carzen | Si lleva batería, mismos requisitos que el calentador |
| 5 | **Mochila de cabina 40x30x20 (medida Ryanair)** | **Nº20 de toda Moda** | 73 | Encaja con tus mochilas. No es estacional. Pocos requisitos legales | Mucha competencia en precio: hay que diferenciarla con la marca Palazzo y buenas fotos |
| — | Mini motosierra de batería | Nº4 de Jardín, con 20.390 valoraciones | 68 | Vídeos virales | **Seguridad (máquinas) y responsabilidad**: no recomendado sin certificación |
| — | Arrancador de baterías | Nº15 de Coche y moto | 66 | Temporada de frío | Batería grande, con restricciones de transporte |
| — | Irrigador bucal | Nº11 de Salud, a 21,89 € | 61 | Demanda estable | Producto de higiene: no se puede devolver una vez abierto, y la competencia es fuerte |
| — | Baliza V16 | 4 fichas en el top 22 de Coche y moto | 57 | La mayor demanda que se ha visto | **Solo es legal si está homologada y conectada a DGT 3.0.** Mucha competencia de marcas. Muy arriesgada en dropshipping |

### Recomendación
1. **Ahora, antes de Navidad: Calora.** Es el producto con más evidencia y ya está casi todo preparado. Solo falta el coste real y la conformidad del producto. Hay que lanzarlo esta semana para llegar a tiempo con los envíos de Navidad.
2. **Línea de catálogo de Palazzo, todo el año:** luz LED con sensor (en pack), mochila de cabina y compresor de ruedas. Son útiles, ligeros y fáciles de anunciar con vídeo.
3. **Producto complementario de Navidad:** el proyector de estrellas, como segundo producto en la cesta o para un pack regalo.
4. **Descartados por ahora:** baliza V16, motosierra e irrigador. Tienen riesgo legal o de responsabilidad y no compensa en dropshipping.

## Mensaje para tu proveedor (cópialo en WhatsApp)
> Hola. Estoy preparando nuevos productos para la tienda. ¿Me puedes confirmar si tienes estos y en qué condiciones?
> 1. Calentador de manos recargable 2 en 1 magnético (el que ya vendemos)
> 2. Luz LED magnética con sensor de movimiento para armario/cocina (recargable USB). Precio por 1, por 3 y por 6 unidades
> 3. Proyector de estrellas / galaxia (tipo astronauta)
> 4. Compresor de aire portátil para ruedas de coche (inalámbrico)
> 5. Mochila de cabina 40x30x20 cm (medida Ryanair)
>
> Para cada uno necesito:
> - Precio por unidad y coste de envío a España.
> - Plazo de entrega real hasta el cliente.
> - Desde qué país se envía.
> - Colores o variantes.
> - Fotos y vídeos reales que pueda usar.
> - Certificado CE y, si lleva batería, UN38.3.
> - Quién es el responsable del producto en la UE.
> - Cómo se gestionan las devoluciones y a qué dirección se envían.
>
> Gracias.

Cuando me pases la respuesta:
- Meto los costes y el sistema calcula los tres precios, el margen y el CPA y el ROAS de equilibrio de cada producto.
- Preparo las fichas completas como **borrador** en Shopify.
- Tú apruebas y se publican.
