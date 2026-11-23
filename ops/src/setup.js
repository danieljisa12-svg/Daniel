// Puesta en marcha y diagnóstico: comprueba DE VERDAD cada conexión (sin suponer nada)
// y deja Shopify preparado (webhooks y catálogo) de forma idempotente.
import { audit } from "./audit.js";
import { syncCatalog } from "./shopify/catalog.js";

const REQUIRED_SCOPES = ["read_orders", "read_products", "write_merchant_managed_fulfillment_orders"];
const TOPICS = ["ORDERS_PAID", "ORDERS_CANCELLED"];

export function webhookUrl(config) {
  return `${config.publicUrl}/webhooks/shopify`;
}
const publicUrlUsable = (config) => /^https:\/\//.test(config.publicUrl) && !/localhost|127\.0\.0\.1/.test(config.publicUrl);

// Da de alta los webhooks que falten. Devuelve lo que ha hecho.
export async function ensureWebhooks(db, config, shopify) {
  if (!publicUrlUsable(config)) throw new Error("PUBLIC_URL debe ser la dirección https pública del servidor");
  const uri = webhookUrl(config);
  const d = await shopify.graphql(`{ webhookSubscriptions(first: 50) { nodes { id topic uri } } }`);
  const existing = d.webhookSubscriptions.nodes;
  const created = [];
  for (const topic of TOPICS) {
    if (existing.some((w) => w.topic === topic && w.uri === uri)) continue;
    const r = await shopify.registerWebhook(topic, uri);
    if (r.userErrors?.length) throw new Error(`${topic}: ${r.userErrors.map((e) => e.message).join("; ")}`);
    created.push(topic);
  }
  // Suscripciones de esta app a otra URL (p. ej. una URL antigua): se avisan, no se borran solas.
  const stale = existing.filter((w) => TOPICS.includes(w.topic) && w.uri !== uri).map((w) => w.uri);
  audit(db, { action: "shopify.webhooks", details: { created, stale } });
  return { created, stale };
}

// Arranque automático: webhooks + catálogo. Nunca tumba el servidor si algo falla.
export async function bootstrap(app) {
  const { db, config, shopify, alert } = app;
  if (config.demo || !shopify) return null;
  const out = {};
  try { out.webhooks = await ensureWebhooks(db, config, shopify); } catch (e) {
    out.webhooksError = e.message;
    await alert("error", "No se pudieron registrar los webhooks de Shopify", e.message);
  }
  try { out.catalog = await syncCatalog(db, shopify); } catch (e) {
    out.catalogError = e.message;
    await alert("error", "No se pudo sincronizar el catálogo de Shopify", e.message);
  }
  return out;
}

// Lista de comprobaciones para el panel ("Puesta en marcha") y para `npm run check`.
export async function diagnostics(app, fetchImpl = globalThis.fetch) {
  const { db, config, shopify } = app;
  const checks = [];
  const add = (id, name, ok, detail, fix = null) => checks.push({ id, name, ok, detail, fix });

  // 1. Servidor
  add("server", "Servidor en la nube con https", publicUrlUsable(config) ? true : config.demo ? "demo" : false,
    publicUrlUsable(config) ? config.publicUrl : "PUBLIC_URL no es una dirección https pública",
    "Despliega en Render y pon en PUBLIC_URL la dirección que te asigne (docs/despliegue-y-costes.md).");
  add("panel", "Panel protegido con contraseña", config.demo ? "demo" : !!(config.panelPassword && config.panelPassword.length >= 12),
    config.demo ? "Modo demo (sin contraseña)" : config.panelPassword && config.panelPassword.length >= 12 ? "Contraseña configurada" : "PANEL_PASSWORD vacía o con menos de 12 caracteres",
    "Pon una contraseña larga en PANEL_PASSWORD (secreto del servidor).");

  // 2. Shopify
  if (!config.shopify.configured) {
    add("shopify", "Conexión con Shopify", config.demo ? "demo" : false, config.demo ? "Simulada en modo demo" : "Faltan SHOPIFY_SHOP, SHOPIFY_CLIENT_ID o SHOPIFY_CLIENT_SECRET",
      "Crea la app en el Dev Dashboard (docs/configurar-shopify.md).");
  } else {
    try {
      const d = await shopify.graphql(`{ shop { name myshopifyDomain } currentAppInstallation { accessScopes { handle } } }`);
      add("shopify", "Conexión con Shopify", true, `${d.shop.name} (${d.shop.myshopifyDomain})`);
      const have = d.currentAppInstallation.accessScopes.map((s) => s.handle);
      const missing = REQUIRED_SCOPES.filter((s) => !have.includes(s));
      add("scopes", "Permisos de la app", missing.length === 0, missing.length ? `Faltan: ${missing.join(", ")}` : REQUIRED_SCOPES.join(", "),
        "Añade los permisos en la versión de la app del Dev Dashboard y vuelve a instalarla.");
      const extra = have.filter((s) => /refund|write_orders|write_customers|write_products/.test(s));
      if (extra.length) add("scopes_extra", "Permisos de más", false, `La app tiene permisos que no necesita: ${extra.join(", ")}`, "Quítalos: aplica el mínimo necesario.");
    } catch (e) {
      add("shopify", "Conexión con Shopify", false, e.message, "Revisa SHOPIFY_SHOP y las credenciales; la app debe estar instalada en la tienda (docs/configurar-shopify.md).");
    }
    if (checks.find((c) => c.id === "shopify")?.ok) {
      try {
        const d = await shopify.graphql(`{ orders(first: 1, sortKey: CREATED_AT, reverse: true) { nodes { name shippingAddress { address1 zip } } } }`);
        const o = d.orders.nodes[0];
        add("pii", "Acceso a la dirección de entrega (datos protegidos)", o ? !!o.shippingAddress?.address1 : null,
          o ? (o.shippingAddress?.address1 ? `Visible en ${o.name}` : `${o.name} llega sin dirección`) : "Sin pedidos para comprobarlo",
          "Dev Dashboard → tu app → Settings → Access requests → Protected customer data: activa nombre, dirección, teléfono y email.");
      } catch (e) {
        add("pii", "Acceso a la dirección de entrega (datos protegidos)", false, e.message,
          "Dev Dashboard → tu app → Settings → Access requests → Protected customer data: activa nombre, dirección, teléfono y email.");
      }
      try {
        const d = await shopify.graphql(`{ webhookSubscriptions(first: 50) { nodes { topic uri } } }`);
        const uri = webhookUrl(config);
        const missing = TOPICS.filter((t) => !d.webhookSubscriptions.nodes.some((w) => w.topic === t && w.uri === uri));
        add("webhooks", "Webhooks de pedidos", missing.length === 0, missing.length ? `Faltan: ${missing.join(", ")}` : `Apuntan a ${uri}`,
          "Pulsa «Registrar webhooks» (o reinicia el servidor: se registran solos).");
      } catch (e) {
        add("webhooks", "Webhooks de pedidos", false, e.message);
      }
    }
  }

  // 3. Proveedor y catálogo
  const sup = db.all("SELECT * FROM suppliers WHERE active = 1");
  add("supplier", "Proveedor configurado", sup.length > 0, sup.length ? sup.map((s) => `${s.name} (+${s.whatsapp})`).join(", ") : "No hay ningún proveedor",
    "Panel → Proveedor → añade el nombre y el WhatsApp de tu proveedor.");
  const cat = db.get(`SELECT count(*) total, sum(supplier_id IS NULL) sin_proveedor, sum(unit_cost IS NULL) sin_coste FROM supplier_products`);
  add("catalog", "Catálogo con proveedor asignado", cat.total > 0 ? cat.sin_proveedor === 0 : false,
    cat.total ? `${cat.total} variantes · ${cat.sin_proveedor} sin proveedor` : "Catálogo vacío",
    cat.total ? "Panel → Proveedor → «Asignar proveedor a todas»." : "Pulsa «Sincronizar catálogo» cuando Shopify esté conectado.");
  add("costs", "Costes de producto (para el beneficio)", cat.total > 0 ? (cat.sin_coste === 0 ? true : null) : null,
    cat.total ? `${cat.sin_coste} variantes sin coste` : "—", "Rellena el coste unitario en Panel → Proveedor.");

  // 4. WhatsApp
  if (!config.whatsapp.apiConfigured) {
    add("whatsapp", "WhatsApp", true, "Modo semiautomático (enlace wa.me + botón). Funciona sin configuración.");
  } else {
    try {
      const res = await fetchImpl(`https://graph.facebook.com/${config.whatsapp.graphVersion}/${config.whatsapp.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`, {
        headers: { Authorization: `Bearer ${config.whatsapp.token}` },
        signal: AbortSignal.timeout(15000),
      });
      const j = await res.json().catch(() => ({}));
      add("whatsapp", "WhatsApp Business Platform (API)", res.ok, res.ok ? `${j.verified_name || ""} ${j.display_phone_number || ""} · calidad ${j.quality_rating || "?"}` : j?.error?.message || `HTTP ${res.status}`,
        "Revisa WHATSAPP_TOKEN (token permanente) y WHATSAPP_PHONE_NUMBER_ID (docs/whatsapp.md).");
    } catch (e) {
      add("whatsapp", "WhatsApp Business Platform (API)", false, e.message);
    }
    const noConsent = sup.filter((s) => !s.consent_at);
    if (noConsent.length) add("consent", "Consentimiento del proveedor", false, `${noConsent.map((s) => s.name).join(", ")}: sin registrar (se usará el modo manual)`, "Panel → Proveedor → marca la casilla de consentimiento.");
    add("wa_webhook", "Webhook de WhatsApp", config.whatsapp.verifyToken ? null : false,
      config.whatsapp.verifyToken ? `Configúralo en Meta con ${config.publicUrl}/webhooks/whatsapp (se verifica cuando Meta lo llama)` : "Falta WHATSAPP_VERIFY_TOKEN");
  }

  // 5. Opcionales
  add("claude", "Claude (respuestas difíciles)", config.claude.configured ? true : null, config.claude.configured ? `Modelo ${config.claude.model}` : "Opcional: sin clave se usan solo reglas");
  add("alerts", "Alertas al móvil", config.alerts.ntfyTopic ? true : null, config.alerts.ntfyTopic ? "ntfy configurado" : "Opcional: ahora solo en el panel");

  const lastSync = db.setting("last_catalog_sync");
  const required = checks.filter((c) => c.ok === false);
  return { ready: required.length === 0, checks, lastCatalogSync: lastSync, at: new Date().toISOString() };
}
