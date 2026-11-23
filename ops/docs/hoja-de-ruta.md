# Hoja de ruta de los agentes

Todos los agentes nuevos siguen las mismas reglas:
- Trabajan sobre la misma base de datos, la cola de tareas, el centro de aprobaciones y el registro.
- Respetan el botón de pausa.
- Nunca ejecutan una acción económica o pública sin una aprobación o una regla con límite.

| Agente | Estado | Qué falta |
|---|---|---|
| **Pedidos y proveedor** | ✅ Construido y probado | Conectar Shopify y, si quieres, la API de WhatsApp |
| **Director** (informe diario, prioridades, alertas) | ✅ Construido | — |
| **Finanzas** | 🟡 Parcial | Costes en el catálogo. Comisiones reales desde Shopify Payments. Gasto publicitario automático (hoy se apunta a mano) |
| **Atención al cliente** | 🟡 Base lista | Canal (correo o chat). La consulta de estado con datos verificados ya existe (`/api/customer/order-status`) |
| **Publicidad** | ⏳ Pendiente | Conectar Meta Marketing API, Google Ads o TikTok Ads |
| **Catálogo** | 🟡 Sincronización | Propuestas de títulos, descripciones y SEO con aprobación y posibilidad de revertir |
| **Optimización de la tienda** | ⏳ Manual | Cambios en un tema duplicado, nunca en el publicado |

## Próximos pasos propuestos (en orden de impacto)
1. **Fase 3/4 · Conectar y activar** (necesita tus credenciales):
   - Desplegar en Render.
   - Crear la app de Shopify.
   - Registrar los webhooks.
   - Sincronizar el catálogo y rellenar los costes.

   Después, recorrer un pedido real en modo semiautomático.
2. **Publicidad (Meta Ads):** este es el agente que más dinero puede mover. Se conecta con la Marketing API oficial.
   - Crea campañas **siempre en pausa** con tope de gasto diario y total.
   - Sincroniza cada día el gasto y las conversiones en `ad_spend`, lo que da beneficio real, ROAS y CPA.
   - Propone pausar o subir presupuesto. Las subidas pasan por Aprobaciones y nunca superan el máximo que fijes.
   - Requisitos: un token de usuario del sistema de Meta con `ads_management` y `ads_read`, y la cuenta publicitaria.
3. **Atención al cliente por correo:**
   - Leer el buzón de soporte (Gmail API o IMAP) y clasificar cada consulta.
   - Contestar solo consultas rutinarias de estado con datos verificados.
   - Dejar las reclamaciones, reembolsos y cambios como borradores en Aprobaciones.
   - Requisitos: acceso al buzón y tus políticas reales publicadas.
4. **Catálogo:**
   - Claude propone mejoras de fichas (título, descripción, SEO).
   - Tú apruebas y se aplican con `productUpdate`, guardando la versión anterior para poder revertir.
   - Los cambios de precio siempre pasan por aprobación.
5. **Varios proveedores por pedido:** dividir el pedido en solicitudes por proveedor.

## Papel de Claude (Agent SDK / tareas programadas)
- **El núcleo no depende de una conversación abierta:** es un servicio con webhooks, cola y planificador propio.
- **Claude se usa donde aporta criterio:** interpretar mensajes (ya integrado y verificado contra el texto), redactar respuestas y fichas, y analizar campañas.
- **Agentes con Claude Agent SDK:** los análisis semanales y la preparación de campañas se pueden ejecutar como agentes del Claude Agent SDK o como tareas programadas de Claude Code. Esos agentes leerían la API del panel y dejarían sus propuestas en Aprobaciones.
