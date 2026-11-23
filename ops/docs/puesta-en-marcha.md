# Puesta en marcha paso a paso (unos 30–40 minutos)

Sigue los pasos en orden. Al final, la pestaña **Puesta en marcha** del panel debe salir toda en verde (✔). Si algo sale en rojo (✖), el panel te dice exactamente qué hacer.

## Paso 1 · Crear la app de Shopify (gratis, 10 min)
1. Entra en el admin de Shopify → **Configuración → Apps → Desarrollar apps** → abre el **Dev Dashboard**.
2. **Crear app** → nombre: `Palazzo Ops`.
3. En la versión de la app, marca **solo** estos permisos:
   `read_orders`, `read_products`, `read_merchant_managed_fulfillment_orders`, `write_merchant_managed_fulfillment_orders`.
4. **Settings → Access requests → Protected customer data → Manage**:
   - Activa **Nombre, Dirección, Teléfono y Email**.
   - Motivo: *"Enviar el pedido al proveedor de dropshipping para que lo entregue al cliente"*.
   - Guarda.
5. Publica la versión e **instálala** en tu tienda desde la tarjeta *Installs*.
6. Apunta el **Client ID** y el **Client secret** de la app. No los pegues en ningún chat: van directamente al paso 2.

## Paso 2 · Publicar el servidor en Render (~7 $/mes, 10 min)
1. Crea una cuenta en **render.com** y conecta tu GitHub.
2. **New → Blueprint** → elige el repositorio `danieljisa12-svg/Daniel` y la rama `claude/shopify-trending-store-krq2d1`. Render lee el archivo `render.yaml`.
3. Render te pide estos valores:
   | Variable | Qué poner |
   |---|---|
   | `PUBLIC_URL` | De momento `https://palazzo-ops.onrender.com`. Corrígela en el paso 4 si Render te da otra |
   | `PANEL_PASSWORD` | Una contraseña larga (12 caracteres o más) para entrar al panel |
   | `SHOPIFY_CLIENT_ID` y `SHOPIFY_CLIENT_SECRET` | Los del paso 1 |
   | `WHATSAPP_*`, `ANTHROPIC_API_KEY` | Déjalos vacíos de momento (opcionales) |
   | `NTFY_TOPIC` | Opcional: un nombre largo inventado para recibir alertas en la app ntfy |

   `SHOPIFY_SHOP` ya viene puesto (`tex377-xd`, el identificador interno de tu tienda) y `SESSION_SECRET` se genera solo.
4. Cuando termine el despliegue, copia la dirección que te asigna Render. Si es distinta de la que pusiste, corrige `PUBLIC_URL` en *Environment*; el servicio se reinicia solo.

**Al arrancar, el servidor registra por sí mismo los webhooks de Shopify e importa tu catálogo.**

## Paso 3 · Configurar el panel (10 min)
Entra en `https://TU-DIRECCION/panel` con tu contraseña.
1. **Puesta en marcha:** comprueba que Shopify, los permisos, la dirección de entrega y los webhooks salen en ✔.
2. **Proveedor:**
   - Añade el nombre y el WhatsApp de tu proveedor, con prefijo de país (ej. `34600111222`).
   - Pulsa **Asignar proveedor a todas las variantes**.
   - Rellena el **coste por unidad** y el **envío** de cada producto; si no, el beneficio no se puede calcular.
3. **Ajustes:**
   - Revisa el margen mínimo y el IVA.
   - **Deja las compras automáticas desactivadas** hasta haber tramitado varios pedidos reales sin problemas.
4. **Alerta de prueba:** en Puesta en marcha pulsa *Enviar alerta de prueba* para comprobar que te llega al móvil.

## Paso 4 · Probar con un pedido de verdad
1. Haz un pedido de prueba en tu tienda (Shopify → *Configuración → Pagos → Modo de prueba*), o un pedido real barato que luego reembolses tú.
2. En unos segundos aparece en **Pedidos**. Los pedidos de prueba de Shopify llegan marcados como "PEDIDO DE PRUEBA" y nunca se envían solos al proveedor.
3. Recorre el flujo en el modo directo, el que tienes por defecto:
   - Abre el pedido. Verás el mensaje con productos y datos de envío ya redactado.
   - Pulsa *Enviar por WhatsApp*, envíalo y pulsa *Ya lo he enviado*.
   - Cuando el proveedor te pase el número de seguimiento, pégalo en el pedido (con la API de WhatsApp llega solo).
   - Aprueba el seguimiento: Shopify marca el pedido como enviado y avisa al cliente.

## Cuando quieras más automatización (opcional)
- **WhatsApp automático (API oficial):** sigue [whatsapp.md](whatsapp.md) y añade las variables `WHATSAPP_*` en Render.
- **Claude** para entender respuestas difíciles: añade `ANTHROPIC_API_KEY`.
- **Compras automáticas:** marca en el catálogo qué productos y con qué importe máximo, y activa la opción en Ajustes.

## Si algo falla
- El panel te avisa en 🔔 y, si configuraste ntfy, en el móvil.
- **Pausar** detiene al instante todo lo que sale hacia fuera.
- **Registro** muestra cada acción con su resultado.
- Desde una terminal con las variables configuradas, `npm run check` hace el mismo diagnóstico.
