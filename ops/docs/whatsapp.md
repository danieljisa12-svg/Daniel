# WhatsApp con tu proveedor

## Modo A: semiautomático (funciona ya, sin configurar nada)
- El sistema redacta el mensaje y crea un enlace oficial `wa.me` con el texto ya escrito.
- En el panel pulsas **Enviar por WhatsApp**: se abre tu WhatsApp con el chat del proveedor. Lo envías tú y pulsas **Ya lo he enviado**.
- Cuando el proveedor conteste, copia su mensaje y pégalo en el pedido. El sistema lo interpreta igual que en el modo automático.
- Tu cuenta corre cero riesgo: no hay ningún bot en tu WhatsApp. **No uses herramientas que automatizan WhatsApp Web**: incumplen las condiciones de WhatsApp y pueden bloquear tu número.

## Modo B: automático (WhatsApp Business Platform, API oficial de Meta)
Tu proveedor **no tiene que cambiar nada**: sigue usando su WhatsApp normal. Quien necesita un número empresarial eres tú.

### Qué necesitas
1. Una **cartera empresarial de Meta** (business.facebook.com).
2. Un **número de teléfono** para la API. Lo más sencillo es un número nuevo que no esté en ninguna app de WhatsApp. Si tu número está en la app *WhatsApp Business*, Meta ofrece en algunos casos la "coexistencia": usar el mismo número en la app y en la API. Compruébalo durante el alta, porque no está disponible en todos los casos. **No uses tu WhatsApp personal.**
3. **El consentimiento de tu proveedor**: avísale de que recibirá los pedidos desde este número y márcalo en Panel → Proveedor. Sin esa marca, el sistema no le escribe por la API.

### Pasos
1. En **developers.facebook.com**, crea una app de tipo **Business** y añade el producto **WhatsApp**.
2. En *WhatsApp → API Setup*, añade tu número y anota el **Phone number ID**.
3. Crea un **usuario del sistema** en la configuración de la empresa con los permisos `whatsapp_business_messaging` y `whatsapp_business_management`. Genera con él un **token permanente**. El token temporal de la página de pruebas caduca en 24 h.
4. En *App settings → Basic*, copia el **App secret**.
5. En *WhatsApp → Configuration → Webhook*:
   - URL de devolución: `https://TU-SERVICIO/webhooks/whatsapp`
   - Token de verificación: el valor que pongas en `WHATSAPP_VERIFY_TOKEN`.
   - Suscríbete al campo **messages**.
6. Crea esta **plantilla** en *WhatsApp Manager → Plantillas*:
   - Nombre: `consulta_pedido_proveedor` · Categoría: **Utilidad** · Idioma: **Español (es)**
   - Cuerpo:
     `Hola, tengo un pedido nuevo con referencia {{1}}: {{2}}. ¿Me confirmas disponibilidad, precio final con envío y plazo de envío? Gracias.`
   - Ejemplo para la revisión: `{{1}}` = `#1007`, `{{2}}` = `Calentador de manos (1 pack) x1`.
7. Pon los secretos en el servidor:
   ```
   WHATSAPP_TOKEN=...            # token permanente del usuario del sistema
   WHATSAPP_PHONE_NUMBER_ID=...
   WHATSAPP_APP_SECRET=...       # para comprobar la firma de cada webhook
   WHATSAPP_VERIFY_TOKEN=...     # el que inventaste en el paso 5
   ```

### Cómo se comporta
- **Primer mensaje de un pedido:** si el proveedor no te ha escrito en las últimas 24 h, Meta obliga a usar la plantilla, y el sistema lo hace solo. Si la conversación está abierta, envía el texto completo.
- **Respuestas del proveedor:** llegan por webhook firmado. El pedido se identifica por la referencia (`#1007`), por el mensaje citado o porque es el único pedido abierto con ese proveedor. Si no está claro, va a **Aprobaciones**.
- **Mensaje sin texto (foto o audio):** te llega una alerta para que lo revises.
- Si la API falla, el mensaje queda como *fallido*, el sistema reintenta y te avisa. Desde el panel puedes pulsar **Reintentar**.

### Costes
Meta cobra por mensaje de plantilla entregado, según la categoría y el país. Las respuestas dentro de la ventana de 24 h no tienen coste. Con un proveedor y pocos pedidos al día son céntimos al mes. Consulta la tabla vigente en la página de precios de WhatsApp Business Platform antes de activarlo.
