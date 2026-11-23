# Despliegue 24/7 y costes

El sistema es **un único servicio Node.js con una base de datos en un archivo (SQLite)**. No necesita tu ordenador encendido: los webhooks de Shopify y WhatsApp lo despiertan, y su planificador interno lanza la vigilancia, los informes y las copias de seguridad.

## Opción recomendada: Render
1. Crea una cuenta en render.com y conecta tu repositorio de GitHub.
2. **New → Blueprint** y elige este repositorio: Render lee `render.yaml` (en la raíz del repositorio).
   - Servicio web **Starter** (no el gratuito: el gratuito se duerme y no tiene disco), región Fráncfort (UE).
   - **Disco persistente** de 1 GB en `/data` para la base de datos y las copias diarias.
3. Rellena los secretos que pide:
   - `PUBLIC_URL`: la URL que te asigne Render.
   - `PANEL_PASSWORD`: una contraseña larga.
   - Las credenciales de Shopify y, si las tienes, las de WhatsApp.
   - `SESSION_SECRET` se genera solo.
4. Cuando esté en marcha entra en `https://TU-SERVICIO/panel`. Los webhooks y el catálogo se configuran solos al arrancar; la pestaña **Puesta en marcha** te confirma que todo está en verde.

> Usa una sola instancia: el disco lo garantiza y evita que dos procesos atiendan la misma cola.

## Costes estimados (compruébalos antes de contratar)
| Servicio | Para qué | Coste aproximado |
|---|---|---|
| Render Starter + disco 1 GB | Servidor 24/7 | ~7 $/mes + ~0,25 $/mes |
| Alternativa: VPS (p. ej. Hetzner) con Docker | Más barato, más mantenimiento | ~4–6 €/mes |
| Shopify (app propia) | Pedidos y envíos | 0 € |
| WhatsApp Business Platform | Modo automático | Céntimos por plantilla; las respuestas en 24 h, gratis |
| Claude API (opcional) | Interpretar respuestas difíciles | Céntimos al mes con poco volumen |
| ntfy.sh | Alertas al móvil | 0 € |
| **Total** | | **~7–10 €/mes** |

## Alertas en el móvil (ntfy, gratis)
1. Instala la app **ntfy** en el móvil.
2. Suscríbete a un tema con un nombre **largo y difícil de adivinar** (p. ej. `palazzo-ops-7f3k9q2m`).
3. Pon ese nombre en `NTFY_TOPIC`.

Las alertas **no llevan datos personales**: solo la referencia del pedido y qué revisar.

## Copias de seguridad
- Cada día a las 03:00 se guarda una copia en `/data/backups`. Se conservan 14.
- Para una copia manual: `npm run backup`.
- Para restaurar: para el servicio, sustituye `/data/ops.db` por la copia y vuelve a arrancar.

## Docker (cualquier servidor)
```bash
docker build -t palazzo-ops ops/
docker run -d --restart unless-stopped -p 8080:8080 -v palazzo-data:/data --env-file .env palazzo-ops
```
Pon delante un proxy con HTTPS (por ejemplo Caddy). Shopify y Meta solo envían webhooks a direcciones `https`.
