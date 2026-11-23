# Palazzo Ops · Sistema de operaciones con IA para la tienda Shopify

Servicio que funciona en la nube las 24 h. Cuando Shopify confirma un pedido pagado, **manda a tu proveedor por WhatsApp los productos y los datos de envío**. Después recoge el número de seguimiento, lo registra en Shopify (que avisa al cliente) y te avisa si algo se tuerce. Todo se ve desde un panel privado en el móvil.

**Modo directo (por defecto):** tu proveedor tiene el stock y hace el envío. Hay un único mensaje por pedido, sin consultas previas.
**Modo consulta (opcional, en Ajustes):** primero se pregunta disponibilidad y precio, y se compra tras tu aprobación. El diagrama de abajo describe este modo completo; en el modo directo se salta los pasos 2 y 3.

> **Estado:** construido y probado (`npm test`: 22 pruebas). Las consultas a Shopify se han verificado contra tu tienda real en modo lectura.
> **Para que funcione con tu tienda sigue [docs/puesta-en-marcha.md](docs/puesta-en-marcha.md)** (unos 30–40 minutos). Al arrancar, el servidor registra solo los webhooks e importa el catálogo. La pestaña **Puesta en marcha** del panel comprueba cada conexión de verdad.

## Cómo funciona

```
 Shopify ──(webhook orders/paid, firmado HMAC)──►  /webhooks/shopify
                                                        │  idempotente (no duplica)
                                                        ▼
                                             Cola persistente (SQLite) ── reintentos 1m·5m·25m·2h
                                                        │
          ┌─────────────────────────────────────────────┼───────────────────────────────┐
          ▼                                             ▼                               ▼
 1. Comprueba el pago en Shopify          2. Consulta al proveedor           Vigilancia cada 15 min
    y asigna proveedor por variante          SIN datos del cliente            (sin respuesta, sin
                                             · API oficial WhatsApp, o        seguimiento, entregas)
                                             · enlace wa.me + botón (manual)
                                                        │
                       respuesta del proveedor ◄────────┘ (webhook WhatsApp o "pegar respuesta")
                                │  interpretada con reglas (+ Claude opcional, verificado contra el texto)
                                ▼
          3. Coste y margen ──► ¿regla de compra automática?  ── no ──► CENTRO DE APROBACIONES (tú)
                                        │ sí (y límites cumplidos)            │ aprobar
                                        ▼                                     ▼
                          4. Pedido al proveedor CON dirección de entrega
                                        │
          5. Número de seguimiento ──► validado (formato y dígito de control) ──► aprobación o regla
                                        ▼
          6. Shopify: fulfillmentCreate + aviso al cliente ──► "Enviado" (solo si Shopify lo confirma)
```

**Estados del pedido:** Nuevo → Pendiente de consultar al proveedor → Disponibilidad confirmada → Pendiente de tu autorización → Pedido solicitado al proveedor → Confirmado por el proveedor → Preparando envío → Enviado con seguimiento → Entregado. Además están Incidencia y Cancelado.

### Reglas de seguridad que aplica el código (y que las pruebas comprueban)
- No se pide nada al proveedor ni se compromete dinero sin tu aprobación. La única excepción es una regla de compra automática que tú actives por producto, con un importe máximo y un margen mínimo.
- La primera consulta al proveedor **no lleva datos del cliente**. La dirección solo se envía cuando apruebas la compra.
- Un pedido **nunca se marca como enviado** si Shopify no confirma el envío. Un número de seguimiento solo se acepta si aparece literalmente en el mensaje del proveedor.
- Si Claude interpreta mal un mensaje, se descarta lo que no esté en el texto y el caso pasa a revisión humana.
- Los webhooks llevan firma HMAC. Los duplicados se ignoran y cada mensaje se envía una sola vez por tipo y pedido.
- Hay un **botón de pausa** que detiene todo lo que sale hacia fuera (mensajes y escrituras en Shopify).
- Se **registra cada acción** con quién la hizo y su resultado.
- Los datos personales se **borran automáticamente** a los 90 días de cerrar el pedido.
- No hay reembolsos ni pagos automáticos. El sistema **no tiene permiso** para hacerlos.

## Probarlo ahora (modo demo, sin conectar nada)

Necesitas Node.js 22.13 o superior.

```bash
cd ops
npm test                      # 22 pruebas automáticas
DEMO_MODE=1 npm start         # panel en http://localhost:8080/panel (en demo no pide contraseña)
```
En el panel, pulsa **Resumen → Simular pedido pagado** y recorre el flujo:
1. Abre el pedido y pulsa "Ya lo he enviado".
2. Pega una respuesta como `Sí hay, 11,50€ con envío, 3-5 días`.
3. Ve a **Aprobaciones** y apruébala.
4. Pega `Enviado por Correos PK123456785ES` y aprueba el seguimiento.

## Qué tienes que conectar

| # | Qué | Para qué | Coste aproximado | Guía |
|---|---|---|---|---|
| 1 | **Servidor en la nube** (Render recomendado) | Que funcione 24/7 sin tu ordenador | ~7 $/mes + disco ~0,25 $/GB | [docs/despliegue-y-costes.md](docs/despliegue-y-costes.md) |
| 2 | **App de Shopify** (Dev Dashboard) | Recibir pedidos y registrar envíos | Gratis | [docs/configurar-shopify.md](docs/configurar-shopify.md) |
| 3 | **Tu proveedor** en el panel (WhatsApp y consentimiento) | Saber a quién escribir | Gratis | Panel → Proveedor |
| 4 | **Catálogo**: proveedor y coste de cada variante | Asignar pedidos y calcular el beneficio | Gratis | Panel → Proveedor |
| 5 | *(Opcional)* **WhatsApp Business Platform** | Enviar y recibir sin pulsar botones | Céntimos por plantilla; las respuestas dentro de 24 h, gratis | [docs/whatsapp.md](docs/whatsapp.md) |
| 6 | *(Opcional)* **Clave de Claude API** | Entender respuestas difíciles del proveedor | Céntimos al mes con poco volumen | `.env.example` |
| 7 | *(Opcional)* **ntfy** | Alertas en el móvil | Gratis | [docs/despliegue-y-costes.md](docs/despliegue-y-costes.md) |

**Hasta que configures el paso 5 funciona en modo semiautomático:** el sistema redacta el mensaje, tú pulsas "Enviar por WhatsApp" (se abre con el texto ya escrito) y después "Ya lo he enviado". Las respuestas del proveedor las pegas en el pedido.

## Estructura

```
ops/
├── src/
│   ├── server.js          HTTP: webhooks, API del panel, archivos del panel, arranque
│   ├── app.js             Monta las piezas y el planificador (informe 08:00, mantenimiento 03:00)
│   ├── config.js          Variables de entorno y comprobaciones de arranque
│   ├── db.js              Esquema SQLite (pedidos, mensajes, aprobaciones, cola, registro…)
│   ├── queue.js           Cola persistente con reintentos y anti-duplicados
│   ├── audit.js           Registro de acciones y alertas (panel + ntfy)
│   ├── orders/            Agente de pedidos y proveedor (estados y lógica)
│   ├── shopify/           Cliente GraphQL Admin (client credentials) y lectura de webhooks
│   ├── whatsapp/          Cloud API oficial, plantillas y redacción de mensajes
│   ├── ai/parser.js       Interpretación de respuestas (reglas + Claude verificado)
│   ├── tracking.js        Validación de números de seguimiento (UPU S10, UPS, YunExpress…)
│   ├── setup.js           Puesta en marcha: diagnóstico real, webhooks y catálogo automáticos
│   ├── finance.js         Agente financiero: facturación ≠ beneficio
│   └── director.js        Agente director: informe diario, prioridades y estado de los agentes
├── public/                Panel (HTML/CSS/JS sin dependencias, para el móvil)
├── scripts/               Webhooks, sincronizar catálogo, copia de seguridad, simulador
├── test/                  Pruebas (node --test)
└── docs/                  Guías de conexión, costes, seguridad, auditoría y hoja de ruta
```

Más información:
- [docs/auditoria-tienda.md](docs/auditoria-tienda.md): resultado de la fase 1.
- [docs/seguridad-rgpd.md](docs/seguridad-rgpd.md): protección de datos.
- [docs/hoja-de-ruta.md](docs/hoja-de-ruta.md): siguientes agentes.
