# Conectar tu tienda Shopify (gratis, unos 15 minutos)

El sistema usa una **app propia** creada en el Dev Dashboard de Shopify. Shopify ya no permite crear apps personalizadas desde el admin al estilo antiguo. La app obtiene su token por sí sola con el *client credentials grant*, así que **no tienes que copiar ningún token**.

## 1. Crear la app
1. En tu admin de Shopify ve a **Configuración → Apps → Desarrollar apps** y entra en el **Dev Dashboard** (dev.shopify.com).
2. Crea una app llamada **Palazzo Ops**. Hazlo dentro de la **organización de tu tienda**: el acceso automático solo funciona si la app y la tienda están en la misma organización.
3. En la versión de la app, selecciona **solo** estos permisos (mínimos necesarios):
   - `read_orders`: leer pedidos y comprobar el pago.
   - `read_products`: sincronizar el catálogo.
   - `read_merchant_managed_fulfillment_orders` y `write_merchant_managed_fulfillment_orders`: registrar el envío con su número de seguimiento.
4. Ve a **Settings → Access requests → Protected customer data** y activa **nombre, dirección, teléfono y email**. Motivo: *"Enviar el pedido al proveedor de dropshipping para que lo entregue al cliente"*. En apps propias no hace falta revisión de Shopify.
   ⚠️ **Sin este paso, Shopify oculta la dirección del cliente.** El sistema lo detecta y deja el pedido en incidencia en vez de mandar al proveedor un pedido incompleto.
5. Publica la versión e **instala la app** en tu tienda desde la tarjeta *Installs*.
6. Copia el **Client ID** y el **Client secret** y ponlos como secretos en el servidor (no en el código):
   ```
   SHOPIFY_SHOP=tex377-xd  # el identificador interno de tu tienda (tex377-xd.myshopify.com)
   SHOPIFY_CLIENT_ID=...
   SHOPIFY_CLIENT_SECRET=...
   ```
   Tu dominio visible es palaazzo.shop, pero la API usa el interno `tex377-xd`.

## 2. Webhooks y catálogo: automáticos
Al arrancar, el servidor hace dos cosas por sí mismo:
- Registra los webhooks `ORDERS_PAID` y `ORDERS_CANCELLED` en `PUBLIC_URL/webhooks/shopify`, solo los que falten. Van firmados con tu *client secret* y se rechaza cualquier petición sin firma válida.
- Importa las variantes activas al catálogo del proveedor sin tocar lo que ya hayas rellenado. Repite la importación cada noche.

También puedes lanzarlo a mano desde **Panel → Puesta en marcha**, o desde la terminal con `npm run shopify:webhooks` y `npm run shopify:sync-products`.

## Errores frecuentes
- **`shop_not_permitted`**: la app y la tienda están en organizaciones distintas. Crea la app desde el Dev Dashboard de la organización de tu tienda.
- **Dirección vacía en los pedidos**: falta el paso 4 (datos protegidos).
- **401 en los webhooks**: `SHOPIFY_CLIENT_SECRET` no coincide con el de la app.
