# SHOPIFY AI COMMERCE · Palazzo

Proyecto de creación y crecimiento de la tienda **Palazzo** (palaazzo.shop): tienda, marca, catálogo, publicidad y agentes.
Estado a **23/11/2026**. Este documento se actualiza al cerrar cada fase.

---

> **Cambio de rumbo (23/11/2026):** el titular quiere una **tienda de un solo producto: Calora**.
> - La tienda usará el tema `calora/theme` (página de venta única). El tema "Palazzo (desarrollo)" se conserva sin publicar por si en el futuro se quiere una tienda con varios productos.
> - Lanzamiento, en un solo paso y con aprobación: (1) retirar del canal Tienda online todos los productos salvo Calora, sin borrarlos; (2) publicar el tema Calora. Se hacen a la vez para que la web publicada (tema Limer) no quede rota.
> - Antes del lanzamiento: compra de prueba desde España (mercados), decidir el precio tachado de Calora (Omnibus) y los días de devolución.

## 1. Qué he comprobado realmente

| Elemento | Cómo | Resultado |
|---|---|---|
| Repositorio `Daniel` | Lectura de los 72 archivos y del historial de git | Hay dos proyectos previos: `calora/` (tema y campañas) y `ops/` (Palazzo Ops). Ambos se conservan sin cambios |
| Sesión anterior "Tienda Shopify producto trending" | Lectura de su historial | Su trabajo está entero en esta rama |
| Tienda Shopify | API Admin GraphQL (solo lectura) | Palazzo, plan Basic, EUR, España, IVA incluido |
| Catálogo | Consulta de los 20 productos | Ver la auditoría de `ops/docs/auditoria-tienda.md`. Ningún producto tiene coste registrado ni SEO; casi todos sin descripción; inventario a 0 |
| Temas | Consulta | 6 temas; el publicado es **Limer**. No se ha tocado ninguno |
| Páginas, menús y políticas | Consulta | 1 página (Contacto), menú con 3 enlaces y **solo la política de privacidad** |
| Pedidos | Consulta | 6 pedidos en total |
| Herramientas | Contenedor | Node 22, Playwright, Theme Check de Shopify y conector oficial de Shopify. **No** hay conector de Meta, TikTok ni Google |
| Limitaciones encontradas | — | El contenedor no puede abrir la tienda por la política de red, y las herramientas de captura y edición de temas del conector piden un permiso extra (ver §4) |

## 2. ¿Existe un proyecto Shopify previo?
Sí. Se conserva todo y no se ha modificado nada existente:
- **`ops/` · Palazzo Ops:** pedidos, WhatsApp con el proveedor, aprobaciones, informe diario, finanzas y panel. Tiene 33 pruebas y todas pasan.
  Ya cumple buena parte de las secciones 18–21 del encargo: backend, base de datos, cola, tareas programadas, webhooks, panel, registro y pausa.
  **No se ha creado un segundo sistema.** Los agentes nuevos se añaden como módulos de este.
- **`calora/`:** tema monoproducto de Calora y plan de Meta Ads.
- **Tienda:** 6 temas, 20 productos y un dominio propio.

## 3. Qué está hecho en esta fase (con evidencias)

| Entregable | Dónde | Cómo se ha verificado |
|---|---|---|
| **Tema Palazzo (desarrollo)**, sin publicar, creado en tu tienda | `palazzo/theme/` · Shopify → Temas → "Palazzo (desarrollo)" | Shopify lo procesó sin errores (`processingFailed: false`). **Theme Check** (el analizador oficial): 0 errores y 0 avisos. JSON y esquemas validados. **Aún no hay capturas** (ver §4) |
| Puntuación de productos candidatos | `ops/src/commerce/scoring.js` | Pruebas automáticas |
| Calculadora de precios (3 propuestas, CPA y ROAS de equilibrio) | `ops/src/commerce/pricing.js` | Pruebas automáticas. Las pruebas encontraron un fallo real: un coste vacío se trataba como 0 €. Corregido |
| Ranking de los productos actuales | `palazzo/productos/candidatos.json` y `node ops/scripts/evaluate-candidates.js ../palazzo/productos/candidatos.json` | Sin costes inventados: todos quedan como **candidato** hasta que el proveedor confirme |
| Guía de marca, logotipo y símbolo | `palazzo/marca/` | Propuesta pendiente de tu aprobación |
| Borradores legales (aviso legal, privacidad, cookies, condiciones, envíos, devoluciones y formulario de desistimiento) | `palazzo/legal/` | Con huecos `[PENDIENTE]`: no se publican hasta tener tus datos reales |

**Qué incluye el tema:**
- Portada con hero, garantías, productos destacados, imagen con texto, colecciones, preguntas frecuentes y suscripción con casilla de consentimiento.
- Cabecera con menú móvil, búsqueda y cesta lateral.
- Ficha de producto con galería deslizable en móvil, variantes, cantidad, pago rápido, garantías, desplegables, barra de compra fija en móvil, productos relacionados y datos estructurados para Google sin valoraciones inventadas.
- Colección con orden y paginación.
- Páginas de búsqueda, cesta, contacto (con campo de número de pedido), preguntas frecuentes, blog, artículo y 404.
- Pie con menús, políticas legales y métodos de pago reales.
- Fuentes alojadas en el propio tema: más rápido y no se envía la IP del visitante a Google.
- Todo el texto, las imágenes y las colecciones se editan desde el editor de Shopify.
- Los productos auxiliares, como "Envío protegido", se ocultan de las listas con la etiqueta `oculto`.

## 4. Accesos que necesito de ti (por orden de impacto)

| # | Qué | Para qué | Cómo (siempre por vía oficial; **nunca** pegues contraseñas en el chat) |
|---|---|---|---|
| 1 | **Reconectar el conector de Shopify con permisos de tema** | Capturas del tema y edición fina de archivos | claude.ai → Ajustes → Conectores → Shopify → reconectar y aceptar todos los permisos |
| 2 | **Datos del proveedor**: catálogo, costes, envío, plazos, devoluciones y país de origen | Precios, fichas y políticas reales | Pásamelos por aquí (lista de precios o capturas de WhatsApp). No se publica nada sin esto |
| 3 | **Datos del titular**: nombre o razón social, NIF, dirección y email de atención | Aviso legal, privacidad y condiciones | Por aquí, o rellenando directamente los `[PENDIENTE]` |
| 4 | **Decisión de nicho** (ver §7) | Marca, portada y publicidad coherentes | Respóndeme |
| 5 | **Meta**: Business Manager, cuenta publicitaria, página e Instagram | Píxel, Conversions API y campañas en pausa | Canal "Facebook e Instagram" de Shopify. Para el agente, un token de usuario del sistema con `ads_read` y `ads_management` |
| 6 | **TikTok Ads** | Píxel y campañas | App oficial "TikTok" de Shopify |
| 7 | **Google**: Merchant Center, Ads, GA4 y Search Console | Shopping, medición y SEO | App oficial "Google & YouTube" de Shopify |
| 8 | **Despliegue de Palazzo Ops**: Render o tu VPS de Hostinger | Que los agentes funcionen 24 h | Ver `ops/docs/despliegue-y-costes.md`. Dime qué plan de Hostinger tienes |

## 5. Costes externos posibles (orientativos; compruébalos antes de contratar)
Nada de esto se ha contratado. Cada gasto pasa por tu aprobación.

| Concepto | Coste aproximado | ¿Necesario? |
|---|---|---|
| Shopify Basic | Ya lo pagas | Sí |
| Servidor para Palazzo Ops (Render Starter con disco, o tu VPS) | Unos 7–10 $/mes en Render; 0 € extra si el VPS de Hostinger sirve | Para la automatización 24 h |
| API de Claude (lectura de mensajes, textos, análisis) | Céntimos o pocos euros al mes con el volumen actual (modelo Haiku) | Opcional |
| Email marketing: Shopify Email | Gratis hasta un cupo mensual de envíos; después, por uso | Recomendado para empezar |
| Klaviyo, como alternativa | Plan gratis limitado; de pago según contactos | Solo si crece la lista |
| Publicidad (Meta, TikTok, Google) | **Lo decides tú**. Propuesta inicial en el plan de campañas: unos 20–30 €/día de prueba en un solo canal | Sí, para vender |
| Revisión legal profesional | Variable | Recomendada antes de escalar |
| Registro de marca en la OEPM | Tasa oficial por clase (consúltala en oepm.es) | Recomendado si apuestas por "Palazzo" |

## 6. Arquitectura recomendada y por qué

```
                   ┌───────────────────────── Shopify (tienda, pagos, catálogo) ─────────────────────────┐
                   │  Tema "Palazzo" · Admin GraphQL API · Webhooks · Flow (opcional) · Shopify Email       │
                   └──────────────▲───────────────────────────────┬─────────────────────────────────────────┘
                                  │ API oficial (permisos mínimos) │ webhooks firmados (HMAC)
┌─────────────────────────────────┴───────────────────────────────▼─────────────────────────────────────────┐
│  PALAZZO OPS (ya construido) · Node 22 + SQLite + cola persistente + planificador + panel móvil           │
│  ├─ Pedidos y proveedor (WhatsApp) ✅    ├─ Director (informe, prioridades) ✅   ├─ Finanzas 🟡            │
│  ├─ NUEVO commerce/scoring + pricing ✅  ├─ Catálogo (propuestas con aprobación) ⏳                       │
│  ├─ Publicidad: Meta / TikTok / Google (lectura de métricas, campañas SIEMPRE en pausa) ⏳                │
│  └─ Centro de aprobaciones · Registro de actividad · Botón de pausa ✅                                   │
└────────────────▲───────────────────────────────────────────────▲─────────────────────────────────────────┘
                 │ Claude API (solo donde aporta criterio)       │ APIs oficiales de Meta, TikTok y Google
          textos, análisis semanal, lectura de mensajes   (con tus tokens, guardados como variables
                                                           de entorno del servidor, nunca en el repositorio)
```

**Por qué esta arquitectura:**
1. **Reutiliza lo que ya funciona.** Palazzo Ops ya tiene cola con reintentos, idempotencia, aprobaciones, registro, pausa, copias de seguridad y 33 pruebas. Duplicarlo sería más caro y más frágil.
2. **Un solo servidor barato.** Funciona 24 h aunque tu ordenador esté apagado y no depende de una conversación abierta con Claude Code.
3. **Cada agente es un módulo con reglas comunes.** Ninguna acción económica o pública se ejecuta sin una aprobación o una regla con límite.
4. **Claude solo se usa donde hace falta criterio.** Los cálculos, como precios, márgenes o ROAS, son código probado, no "opiniones" del modelo.
5. **El tema se desarrolla en una copia sin publicar.** Se publica solo cuando tú lo apruebes.

## 7. Decisiones que necesito (agrupadas)
1. **Nicho.** El catálogo actual mezcla ropa, mochilas, paraguas, mascotas, limpieza de coche y calentadores. El tema funciona como tienda de selección general, pero la publicidad y la marca rinden mucho más con un foco claro. Opciones:
   - **A)** Palazzo como tienda de **"útiles de invierno y regalo"** durante esta campaña (Calora y el paraguas), ampliándola después.
   - **B)** Palazzo como **hogar y viaje**: mochilas, paraguas y productos de mascotas.
   - **C)** **Una marca por nicho**: Carzen para el coche y Calora para el calor, con Palazzo como tienda general.
2. **Marca.** ¿Apruebas la propuesta de `palazzo/marca/` (verde, marfil y latón; Fraunces y Manrope; "Cosas útiles, bien elegidas.")?
3. **Productos auxiliares.** ¿Puedo poner la etiqueta `oculto` a "Envío rápido/protegido" y "Fast shipping/Protected shipment" para que no salgan en las listas? No se borra nada.
4. ~~Pantalón bombacho~~: descartado el 23/11. Se queda en borrador en Shopify.

## 8. Tablero de tareas
Estados: ✅ hecho y verificado · 🔄 en curso · ⏳ pendiente · ⛔ bloqueado (se indica por qué).

| Fase | Tarea | Agente | Estado | Criterio de finalización |
|---|---|---|---|---|
| 1 Auditoría | Inspección del repositorio, la tienda y las herramientas | Director | ✅ | Este documento |
| 1 | Arquitectura, accesos y costes | Director | ✅ | §4–§6 |
| 2 Marca | Posicionamiento, colores, tipografías, logotipo y tono | Branding | ✅ aprobada 23/11 | Pendiente: búsqueda en OEPM y EUIPO |
| 2 | Aplicaciones: redes, plantillas de anuncio y newsletter | Branding / Contenido | ⏳ | Tras aprobar la marca |
| 3 Tienda | Tema de desarrollo sin publicar | Diseñador | 🔄 | ✅ Creado y Theme Check limpio · ⛔ faltan capturas móvil y escritorio (necesita el permiso §4.1) |
| 3 | Páginas: envíos y devoluciones, FAQ, aviso legal | Diseñador / Legal | ⛔ | Faltan tus datos (§4.3) y los del proveedor (§4.2) |
| 3 | Menú principal y pie: colecciones, ayuda y legal | Catálogo | ⏳ | Tras decidir el nicho (§7.1) |
| 3 | Publicación del tema | Director | ⛔ | Solo con tu aprobación explícita y tras la compra de prueba |
| 4 Catálogo | Puntuación y precios | Investigador / Finanzas | ✅ | Pruebas en verde |
| 4 | Investigación de productos con venta real | Investigador | ✅ 23/11 | `productos/investigacion-2026-11.md` |
| 4 | Fichas completas: copy, SEO y texto alternativo de imágenes | Catálogo | ⏳ | Primero como borradores; se publican tras tu aprobación |
| 4 | Costes reales en Shopify | Catálogo / Finanzas | ⛔ | Datos del proveedor |
| 5 Integraciones | Píxeles de Meta, TikTok y Google con consentimiento | Ads | ⛔ | Accesos §4.5–4.7 |
| 5 | Shopify Email: flujo de bienvenida y carrito abandonado | Email | ⏳ | Solo a contactos con consentimiento |
| 6 Publicidad | Campañas Meta preparadas (Calora ya tiene plan) | Meta Ads | 🔄 | Campañas creadas EN PAUSA y presupuesto aprobado por ti |
| 6 | Guiones TikTok y calendario editorial | TikTok / Contenido | ⏳ | — |
| 6 | Feed y campañas Shopping | Google Ads | ⏳ | Merchant Center sin errores |
| 7 Lanzamiento | Compra de prueba, impuestos, envíos y políticas | Conversión | ⛔ | Políticas reales publicadas |
| 8 Crecimiento | Agente de publicidad en Palazzo Ops (métricas diarias y propuestas) | Ads / Finanzas | ⏳ | Tokens de Meta |

## 9. Próximos pasos que haré sin necesitar nada de ti
1. Investigación de productos tendencia para España con fuentes citadas. Se añaden a `candidatos.json` y al ranking.
2. Fichas mejoradas de los productos actuales (título, descripción, SEO y texto alternativo de imágenes), preparadas como propuesta sin aplicarlas.
3. Guiones de vídeo para TikTok y Reels y calendario editorial de diciembre.
4. Integrar candidatos y precios en el panel de Palazzo Ops, con una pestaña **Productos** y aprobaciones.
