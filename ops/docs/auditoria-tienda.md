# Fase 1 · Auditoría de la tienda Palazzo (solo lectura, 23/11/2026)

Datos leídos con la API de Shopify, sin cambiar nada. Ordenados por impacto.

## 🔴 Urgente
1. **Tu producto más vendido no está a la venta.** El *PALAZZO® Pantalón Bombacho* aparece en 4 de los 6 pedidos de la tienda y está en **Borrador**. Si sigue teniendo proveedor, reactívalo.
2. **Faltan políticas obligatorias.** Solo está publicada la política de privacidad. En España tienes que mostrar:
   - **Política de devoluciones**, con el derecho de desistimiento de 14 días.
   - **Política de envíos**.
   - **Términos del servicio**.
   - **Aviso legal** (LSSI): titular, NIF, dirección y email.

   Se crean en *Configuración → Políticas*. Además, la automatización de atención al cliente necesita las políticas reales para no inventar respuestas.
3. **No hay ventas desde el 17/09/2026.** Hay 6 pedidos en total. Con este volumen, lo que más rentabilidad da ahora es **conseguir tráfico** (publicidad) y poner a la venta lo que ya vendía. La automatización ahorra tiempo cuando hay pedidos.

## 🟠 Importante
4. **Ningún producto tiene coste registrado** y solo Calora tiene SKU. Sin coste no se puede calcular el beneficio. Rellénalo en el panel (Proveedor → Catálogo) o en Shopify (*coste por artículo*).
5. **"Fuente de agua para mascotas"** controla inventario con 0 unidades, así que probablemente sale como agotada. En dropshipping, desactiva el control de inventario o permite vender sin stock.
6. **Productos de servicio duplicados:** "Envío rápido." / "Fast shipping" y "Envío protegido." / "Protected shipment", a 2 € cada uno. "Fast shipping" además controla inventario con 0, así que no se puede comprar.
   - Recomendación: deja una sola versión en español, ocúltala de búsquedas y colecciones, o cobra el envío urgente como tarifa de envío.
   - El sistema ya los excluye de los pedidos al proveedor.
7. **Catálogo muy disperso bajo una sola marca:** ropa, paraguas, mochilas, limpieza de coche, mascotas, juguetes y calentadores. Esto resta confianza. Mejor una tienda o marca por nicho, o colecciones muy separadas con su propia portada.

## 🟡 Mejoras
8. La URL del paraguas lleva el símbolo ®: `/products/paraguas-nublo®`. Cámbiala a `paraguas-nublo`; Shopify crea la redirección.
9. Los precios tachados deben ser el precio más bajo de los 30 días anteriores (directiva Omnibus). Revisa Calora (59,90 €), Paraguas (45 €), Limer (50 €) y el calendario de adviento (60 €).
10. La ubicación de envío se llama "Mex". Comprueba que la dirección de origen y las tarifas de envío corresponden a tu proveedor real.

## Qué se puede automatizar ya
- **Pedido pagado → consulta al proveedor → aprobación → pedido → seguimiento → Shopify:** construido. Falta conectarlo (ver README).
- **Informe diario, alertas, cálculo de beneficio y registro de acciones:** construido.
- **Atención al cliente, publicidad y cambios de catálogo:** pendientes de conectar sus canales (ver [hoja-de-ruta.md](hoja-de-ruta.md)).

## Riesgos que hay que resolver
- **Contrato con el proveedor (RGPD):** como recibe datos de tus clientes, es *encargado del tratamiento*. Ver [seguridad-rgpd.md](seguridad-rgpd.md).
- **Número de WhatsApp:** para el modo automático necesitas un número empresarial que no sea tu WhatsApp personal.
- **Un solo proveedor por pedido:** si un pedido mezcla productos de varios proveedores, queda en incidencia. Esto está previsto ampliarlo más adelante.
