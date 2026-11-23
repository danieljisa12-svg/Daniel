# Seguridad y protección de datos (RGPD / LOPDGDD)

> Esto es una guía técnica, no asesoramiento legal. Revisa los textos legales con un profesional.

## Qué datos guarda el sistema y por qué
| Dato | Para qué | Cuánto tiempo |
|---|---|---|
| Nombre, dirección y teléfono de entrega | Que el proveedor entregue el pedido (ejecución del contrato, art. 6.1.b RGPD) | Se borran a los `PII_RETENTION_DAYS` (90 por defecto) tras cerrar el pedido |
| Email del cliente | Identificar el pedido en atención al cliente | Igual que lo anterior |
| Mensajes con el proveedor | Historial y pruebas del estado del envío | El mensaje con la dirección se borra junto con los datos del pedido |
| Registro de acciones | Trazabilidad | Sin datos personales |

Los datos fiscales y las facturas siguen en Shopify, que es donde deben conservarse a efectos fiscales. Este sistema solo guarda una copia operativa mínima.

## Medidas aplicadas en el código
- **Minimización:** la consulta al proveedor no lleva datos del cliente. La dirección solo se envía tras tu aprobación (o una regla automática que tú actives).
- **Alertas sin datos personales:** a ntfy solo llegan la referencia del pedido y qué revisar.
- **Secretos fuera del código:** todo va en variables de entorno o en los secretos del proveedor de hosting. `.env` está en `.gitignore`.
- **Webhooks autenticados:** HMAC de Shopify y `X-Hub-Signature-256` de Meta, comparados en tiempo constante.
- **Panel protegido:**
  - Contraseña de 12 caracteres o más y cookie firmada `HttpOnly`, `Secure` y `SameSite=Strict`.
  - Bloqueo de 15 minutos tras 5 intentos fallidos.
  - Protección CSRF y cabeceras de seguridad (CSP, X-Frame-Options).
- **Permisos mínimos:** Shopify solo con permisos de lectura de pedidos y productos y de escritura de envíos. **No hay permiso para reembolsos ni cobros.**
- **Supresión:** el webhook `customers/redact` borra los datos del cliente que lo solicite.
- **Copias de seguridad diarias** en el disco del servidor (14 días). El servidor está en la UE (Render, Fráncfort).

## Lo que tienes que hacer tú
1. **Contrato de encargado del tratamiento (art. 28 RGPD)** con tu proveedor. Si el proveedor está fuera del Espacio Económico Europeo (por ejemplo, China), además hay una **transferencia internacional**: necesitas cláusulas contractuales tipo e informarlo en tu política de privacidad.
2. **Actualiza tu política de privacidad** con los destinatarios: el proveedor logístico, Meta/WhatsApp (si usas la API), el hosting del sistema y Anthropic (si activas Claude). A Claude solo se le envían los mensajes del proveedor, no las fichas de clientes.
3. **Registro de actividades de tratamiento:** añade "gestión de pedidos con proveedor".
4. **Consentimiento del proveedor** para recibir mensajes automatizados: márcalo en el panel.
5. Si algún día envías **email marketing**, hazlo solo a clientes con consentimiento: Shopify guarda ese estado. El sistema no envía publicidad.
