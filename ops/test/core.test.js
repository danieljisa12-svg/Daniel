import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/app.js";
import { createServer } from "../src/server.js";
import { normalizeOrderWebhook } from "../src/shopify/orders.js";
import { verifyShopifyHmac, verifyMetaSignature } from "../src/util/crypto.js";
import { parseSupplierReplyRules, mergeWithClaude } from "../src/ai/parser.js";
import { isValidS10, classifyTracking } from "../src/tracking.js";
import { seedDemo, demoOrderPayload } from "../scripts/demo-data.js";

const SECRET = "test-shopify-secret";
const APP_SECRET = "test-meta-secret";

function makeApp({ demo = true, whatsappApi = false, shopify = null, whatsapp = null, settings = {} } = {}) {
  const config = loadConfig({
    dataDir: ":memory:",
    demo,
    panelPassword: "contraseña-de-prueba-larga",
    sessionSecret: "x".repeat(40),
    publicUrl: "http://localhost",
    shopify: { shop: demo ? "" : "tienda", clientId: demo ? "" : "id", clientSecret: SECRET, apiVersion: "2026-10" },
    whatsapp: { token: whatsappApi ? "t" : "", phoneNumberId: whatsappApi ? "123" : "", appSecret: whatsappApi ? APP_SECRET : "", verifyToken: "verif", graphVersion: "v23.0", templateConsulta: "consulta_pedido_proveedor", templatePedido: "pedido_nuevo_proveedor", templateLang: "es" },
    claude: { apiKey: "", model: "x" },
    alerts: { ntfyTopic: "", ntfyServer: "https://ntfy.sh" },
  });
  const app = createApp(config, { shopify, whatsapp });
  seedDemo(app.db);
  for (const [k, v] of Object.entries({ order_flow: "consulta", ...settings })) app.db.setSetting(k, v);
  return app;
}
const order = (app, id) => app.orders.getOrder(id);

test("HMAC de Shopify y firma de Meta", () => {
  const body = Buffer.from('{"a":1}');
  const h = crypto.createHmac("sha256", SECRET).update(body).digest("base64");
  assert.equal(verifyShopifyHmac(body, h, SECRET), true);
  assert.equal(verifyShopifyHmac(body, h, "otro"), false);
  assert.equal(verifyShopifyHmac(Buffer.from('{"a":2}'), h, SECRET), false);
  const s = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(body).digest("hex");
  assert.equal(verifyMetaSignature(body, s, APP_SECRET), true);
  assert.equal(verifyMetaSignature(body, "sha256=00", APP_SECRET), false);
});

test("Intérprete de respuestas del proveedor", () => {
  let p = parseSupplierReplyRules("Sí hay, 11,50€ con envío, llega en 3-5 días #1007");
  assert.deepEqual([p.available, p.price, p.priceIsTotal, p.etaDays, p.orderRefs[0], p.ambiguous], [true, 11.5, true, 5, "#1007", false]);
  p = parseSupplierReplyRules("Lo siento, del gris no queda, agotado");
  assert.equal(p.available, false);
  p = parseSupplierReplyRules("Hay stock: 8€ la unidad y 3€ de envío");
  assert.deepEqual([p.unitPrice, p.shippingPrice, p.ambiguous], [8, 3, false]);
  p = parseSupplierReplyRules("Tengo 10€ y 12€, depende");
  assert.equal(p.ambiguous, true);
  p = parseSupplierReplyRules("Ya ha salido por Correos, seguimiento PK123456785ES");
  assert.deepEqual([p.tracking, p.carrier, p.status], ["PK123456785ES", "Correos", "enviado"]);
  p = parseSupplierReplyRules("hola qué tal");
  assert.equal(p.ambiguous, true);
});

test("Claude no puede inventar precios ni seguimientos", () => {
  const text = "Sí, lo tengo";
  const rules = parseSupplierReplyRules(text);
  const m = mergeWithClaude(text, rules, { available: true, price: 9.99, tracking: "RR123456785ES", ambiguous: false });
  assert.equal(m.price, null);
  assert.equal(m.tracking, null);
  assert.equal(m.ambiguous, true);
});

test("Validación de números de seguimiento", () => {
  assert.equal(isValidS10("RR123456785ES"), true);
  assert.equal(isValidS10("RR123456784ES"), false); // dígito de control erróneo
  assert.equal(classifyTracking("1Z999AA10123456784").carrier, "UPS");
  assert.equal(classifyTracking("hola"), null);
});

test("Flujo completo semiautomático: consulta sin datos personales → aprobación → pedido → seguimiento → Shopify", async () => {
  const app = makeApp();
  const { id } = app.orders.ingestPaidOrder(normalizeOrderWebhook(demoOrderPayload(2001)));
  await app.queue.runDue();
  let o = order(app, id);
  assert.equal(o.status, "pendiente_consulta");

  const consulta = app.db.get("SELECT * FROM messages WHERE order_id = ? AND kind = 'consulta'", id);
  assert.equal(consulta.status, "listo_para_enviar");
  assert.match(consulta.body, /#2001/);
  assert.doesNotMatch(consulta.body, /Calle Falsa|Lucía|600 000 001/, "la consulta no debe llevar datos del cliente");
  assert.match(app.orders.messageLink(consulta.id), /^https:\/\/wa\.me\/34600000000\?text=/);
  app.orders.markManualSent(consulta.id);

  await app.orders.receiveSupplierMessage({ text: "Sí hay, 11,50€ con envío, 3-5 días", orderId: id, channel: "whatsapp_manual" });
  o = order(app, id);
  assert.equal(o.status, "pendiente_autorizacion");
  assert.equal(o.supplier_total_cost, 11.5);
  const ap = app.db.get("SELECT * FROM approvals WHERE order_id = ? AND type = 'compra_proveedor'", id);
  assert.equal(ap.amount, 11.5);
  assert.equal(app.db.get("SELECT count(*) n FROM messages WHERE order_id = ? AND kind = 'pedido'", id).n, 0, "sin aprobación no se pide nada");

  await app.orders.decideApproval(ap.id, "aprobar");
  o = order(app, id);
  assert.equal(o.status, "solicitado_proveedor");
  const pedido = app.db.get("SELECT * FROM messages WHERE order_id = ? AND kind = 'pedido'", id);
  assert.match(pedido.body, /Calle Falsa 123/);

  await app.orders.receiveSupplierMessage({ text: "Ya ha salido por Correos, seguimiento PK123456785ES", orderId: id, channel: "whatsapp_manual" });
  assert.equal(order(app, id).status, "solicitado_proveedor", "no se marca enviado sin confirmar");
  const apT = app.db.get("SELECT * FROM approvals WHERE order_id = ? AND type = 'seguimiento' AND status='pendiente'", id);
  assert.ok(apT);
  await app.orders.decideApproval(apT.id, "aprobar");
  await app.queue.runDue();
  o = order(app, id);
  assert.equal(o.status, "enviado");
  assert.equal(o.tracking_number, "PK123456785ES");
  assert.equal(o.tracking_company, "Correos");
});

test("Pedido duplicado no se procesa dos veces", async () => {
  const app = makeApp();
  const a = app.orders.ingestPaidOrder(normalizeOrderWebhook(demoOrderPayload(2002)));
  const b = app.orders.ingestPaidOrder(normalizeOrderWebhook(demoOrderPayload(2002)));
  assert.equal(b.duplicate, true);
  assert.equal(a.id, b.id);
  await app.queue.runDue();
  assert.equal(app.db.get("SELECT count(*) n FROM messages WHERE order_id = ?", a.id).n, 1);
});

test("Compra automática solo dentro de la regla autorizada", async () => {
  const app = makeApp({ settings: { auto_purchase_enabled: true } });
  const { id } = app.orders.ingestPaidOrder(normalizeOrderWebhook(demoOrderPayload(2003)));
  await app.queue.runDue();
  await app.orders.receiveSupplierMessage({ text: "Disponible, 11€ total con envío", orderId: id });
  assert.equal(order(app, id).status, "solicitado_proveedor");
  assert.equal(app.db.get("SELECT count(*) n FROM approvals WHERE order_id = ?", id).n, 0);

  // Supera el importe máximo (15 €) → pide aprobación.
  const r2 = app.orders.ingestPaidOrder(normalizeOrderWebhook(demoOrderPayload(2004)));
  await app.queue.runDue();
  await app.orders.receiveSupplierMessage({ text: "Disponible, 19€ total con envío", orderId: r2.id });
  assert.equal(order(app, r2.id).status, "pendiente_autorizacion");

  // Precio sin aclarar si incluye envío → no es "confirmado" → pide aprobación.
  const r3 = app.orders.ingestPaidOrder(normalizeOrderWebhook(demoOrderPayload(2005)));
  await app.queue.runDue();
  await app.orders.receiveSupplierMessage({ text: "Sí lo tengo, 10€", orderId: r3.id });
  assert.equal(order(app, r3.id).status, "pendiente_autorizacion");
});

test("Botón de pausa detiene las acciones hacia fuera", async () => {
  const app = makeApp({ settings: { automation_paused: true } });
  const { id } = app.orders.ingestPaidOrder(normalizeOrderWebhook(demoOrderPayload(2006)));
  await app.queue.runDue();
  assert.equal(order(app, id).status, "nuevo");
  app.db.setSetting("automation_paused", false);
  app.db.run("UPDATE jobs SET run_at = datetime('now')");
  await app.queue.runDue();
  assert.equal(order(app, id).status, "pendiente_consulta");
});

test("Sin stock o producto sin proveedor → incidencia (nunca se inventa)", async () => {
  const app = makeApp();
  const { id } = app.orders.ingestPaidOrder(normalizeOrderWebhook(demoOrderPayload(2007)));
  await app.queue.runDue();
  await app.orders.receiveSupplierMessage({ text: "No queda, agotado", orderId: id });
  assert.equal(order(app, id).status, "incidencia");

  const r = app.orders.ingestPaidOrder(normalizeOrderWebhook(demoOrderPayload(2008, { variant: 999, sku: null, title: "Producto desconocido", variantTitle: null })));
  await app.queue.runDue();
  const o = order(app, r.id);
  assert.equal(o.status, "incidencia");
  assert.match(o.incident, /sin proveedor asignado/);
});

test("Los productos de servicio (Envío rápido) no se piden al proveedor", async () => {
  const app = makeApp();
  const { id } = app.orders.ingestPaidOrder(normalizeOrderWebhook(demoOrderPayload(2009, { extra: [{ title: "Envío rápido.", price: "2.00" }] })));
  await app.queue.runDue();
  const o = order(app, id);
  assert.equal(o.status, "pendiente_consulta");
  const m = app.db.get("SELECT body FROM messages WHERE order_id = ?", id);
  assert.doesNotMatch(m.body, /Envío rápido/);
});

test("Modo API: plantilla fuera de ventana, pago verificado en Shopify y envío real a Shopify", async () => {
  const sent = [];
  const fulfilled = [];
  const whatsapp = {
    sendText: async (to, text) => { sent.push({ type: "text", to, text }); return "wamid.T" + sent.length; },
    sendConsultaTemplate: async (to, ref, summary) => { sent.push({ type: "template", to, ref, summary }); return "wamid.P" + sent.length; },
  };
  const shopify = {
    getOrderPaymentStatus: async () => ({ displayFinancialStatus: "PAID", cancelledAt: null }),
    createFulfillmentWithTracking: async (gid, t) => { fulfilled.push({ gid, ...t }); return { id: "gid://shopify/Fulfillment/1" }; },
  };
  const app = makeApp({ demo: false, whatsappApi: true, shopify, whatsapp, settings: { auto_tracking_to_shopify: true } });
  const { id } = app.orders.ingestPaidOrder(normalizeOrderWebhook(demoOrderPayload(2010, { test: false })));
  await app.queue.runDue();
  await app.queue.runDue();
  assert.equal(sent[0].type, "template", "sin conversación abierta se usa plantilla");
  assert.match(sent[0].summary, /Calora/);
  assert.equal(app.db.get("SELECT status FROM messages WHERE order_id=? AND kind='consulta'", id).status, "enviado");

  // Respuesta del proveedor citando nuestro mensaje (sin referencia en el texto).
  await app.orders.receiveSupplierMessage({ from: "34600000000", text: "Sí hay, 12€ total con envío", waId: "wamid.IN1", contextId: "wamid.P1" });
  assert.equal(order(app, id).status, "pendiente_autorizacion");
  const ap = app.db.get("SELECT id FROM approvals WHERE order_id=? AND status='pendiente'", id);
  await app.orders.decideApproval(ap.id, "aprobar");
  await app.queue.runDue();
  assert.equal(sent[1].type, "text", "dentro de la ventana de 24 h se usa texto libre");
  assert.match(sent[1].text, /Calle Falsa 123/);

  await app.orders.receiveSupplierMessage({ from: "34600000000", text: "Enviado por UPS: 1Z999AA10123456784", waId: "wamid.IN2" });
  await app.queue.runDue();
  const o = order(app, id);
  assert.equal(o.status, "enviado");
  assert.equal(fulfilled.length, 1);
  assert.equal(fulfilled[0].number, "1Z999AA10123456784");
});

test("Si Shopify falla al crear el envío, el pedido NO se marca como enviado", async () => {
  const shopify = {
    getOrderPaymentStatus: async () => ({ displayFinancialStatus: "PAID" }),
    createFulfillmentWithTracking: async () => { throw new Error("Shopify caído"); },
  };
  const app = makeApp({ demo: false, shopify });
  const { id } = app.orders.ingestPaidOrder(normalizeOrderWebhook(demoOrderPayload(2011)));
  await app.queue.runDue();
  app.db.run("UPDATE orders SET status='solicitado_proveedor' WHERE id=?", id);
  app.queue.enqueue("shopify.fulfill", { orderId: id, number: "RR123456785ES", company: "Correos" }, { dedupeKey: "f" , maxAttempts: 1 });
  await app.queue.runDue();
  assert.equal(order(app, id).status, "solicitado_proveedor");
  assert.equal(app.db.get("SELECT status FROM jobs WHERE dedupe_key='f'").status, "fallido");
  assert.ok(app.db.get("SELECT id FROM alerts WHERE level='error'"));
});

test("Servidor: webhooks firmados, duplicados, panel protegido", async () => {
  const app = makeApp({ demo: false });
  const server = createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const body = JSON.stringify(demoOrderPayload(3001));
    const hmac = crypto.createHmac("sha256", SECRET).update(body).digest("base64");
    const h = (extra = {}) => ({ "Content-Type": "application/json", "X-Shopify-Topic": "orders/paid", "X-Shopify-Webhook-Id": "evt-1", ...extra });
    let r = await fetch(base + "/webhooks/shopify", { method: "POST", headers: h({ "X-Shopify-Hmac-Sha256": "falso" }), body });
    assert.equal(r.status, 401);
    r = await fetch(base + "/webhooks/shopify", { method: "POST", headers: h({ "X-Shopify-Hmac-Sha256": hmac }), body });
    assert.equal(r.status, 200);
    r = await fetch(base + "/webhooks/shopify", { method: "POST", headers: h({ "X-Shopify-Hmac-Sha256": hmac }), body });
    assert.equal(await r.text(), "duplicado");
    assert.equal(app.db.get("SELECT count(*) n FROM orders").n, 1);

    r = await fetch(base + "/api/summary");
    assert.equal(r.status, 401);
    r = await fetch(base + "/api/login", { method: "POST", body: JSON.stringify({ password: "mal" }) });
    assert.equal(r.status, 401);
    r = await fetch(base + "/api/login", { method: "POST", body: JSON.stringify({ password: "contraseña-de-prueba-larga" }) });
    const cookie = r.headers.get("set-cookie").split(";")[0];
    r = await fetch(base + "/api/summary", { headers: { cookie } });
    assert.equal(r.status, 200);
    r = await fetch(base + "/api/pause", { method: "POST", headers: { cookie }, body: JSON.stringify({ paused: true }) });
    assert.equal(r.status, 403, "sin cabecera anti-CSRF se rechaza");
    r = await fetch(base + "/api/pause", { method: "POST", headers: { cookie, "x-requested-with": "ops-panel" }, body: JSON.stringify({ paused: true }) });
    assert.equal(r.status, 200);
    assert.equal(app.db.setting("automation_paused"), true);

    // WhatsApp: verificación y firma
    r = await fetch(base + "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verif&hub.challenge=42");
    assert.equal(await r.text(), "42");
    r = await fetch(base + "/webhooks/whatsapp", { method: "POST", headers: { "X-Hub-Signature-256": "sha256=00" }, body: "{}" });
    assert.equal(r.status, 401);
  } finally {
    server.close();
    app.stop();
  }
});

test("RGPD: se borran los datos personales de pedidos cerrados antiguos", async () => {
  const app = makeApp();
  const { id } = app.orders.ingestPaidOrder(normalizeOrderWebhook(demoOrderPayload(2012)));
  app.db.run("UPDATE orders SET status='entregado', updated_at=datetime('now','-200 days') WHERE id=?", id);
  assert.equal(app.orders.purgePii(), 1);
  const o = order(app, id);
  assert.equal(o.ship_address1, null);
  assert.equal(o.customer_email, null);
  assert.ok(o.pii_purged_at);
});

test("Sin dirección de entrega (datos protegidos desactivados) no se pide al proveedor", async () => {
  const app = makeApp();
  const payload = demoOrderPayload(2013);
  delete payload.shipping_address;
  const { id } = app.orders.ingestPaidOrder(normalizeOrderWebhook(payload));
  await app.queue.runDue();
  assert.equal(order(app, id).status, "pendiente_consulta", "la consulta sin datos personales sí se puede hacer");
  await app.orders.receiveSupplierMessage({ text: "Sí hay, 11€ total con envío", orderId: id });
  const ap = app.db.get("SELECT id FROM approvals WHERE order_id = ? AND status='pendiente'", id);
  await app.orders.decideApproval(ap.id, "aprobar");
  const o = order(app, id);
  assert.equal(o.status, "incidencia");
  assert.match(o.incident, /datos protegidos/);
  assert.equal(app.db.get("SELECT count(*) n FROM messages WHERE order_id=? AND kind='pedido'", id).n, 0);
});

// ---------- Puesta en marcha, aprobaciones robustas y WhatsApp entrante ----------
import { diagnostics, ensureWebhooks } from "../src/setup.js";
import { syncCatalog } from "../src/shopify/catalog.js";

function fakeShopify({ subs = [], withAddress = true, scopes = ["read_orders", "read_products", "write_merchant_managed_fulfillment_orders"] } = {}) {
  const created = [];
  return {
    created,
    registerWebhook: async (topic, uri) => { subs.push({ topic, uri }); created.push(topic); return { webhookSubscription: { id: "w" + created.length, topic }, userErrors: [] }; },
    listProducts: async () => ({ products: { pageInfo: { hasNextPage: false }, nodes: [
      { id: "p1", title: "Calora", status: "ACTIVE", variants: { nodes: [{ id: "gid://shopify/ProductVariant/9001", title: "1 pack", sku: "C1", inventoryItem: { unitCost: { amount: "8.40" } } }] } },
      { id: "p2", title: "Envío rápido.", status: "ACTIVE", variants: { nodes: [{ id: "gid://shopify/ProductVariant/9002", title: "Default Title", sku: null, inventoryItem: { unitCost: null } }] } },
      { id: "p3", title: "Borrador", status: "DRAFT", variants: { nodes: [{ id: "gid://shopify/ProductVariant/9003", title: "Default Title", sku: null, inventoryItem: null }] } },
    ] } }),
    graphql: async (q) => {
      if (q.includes("webhookSubscriptions")) return { webhookSubscriptions: { nodes: subs } };
      if (q.includes("currentAppInstallation")) return { shop: { name: "Palazzo", myshopifyDomain: "tex377-xd.myshopify.com" }, currentAppInstallation: { accessScopes: scopes.map((handle) => ({ handle })) } };
      if (q.includes("shippingAddress")) return { orders: { nodes: [{ name: "#1006", shippingAddress: withAddress ? { address1: "Calle 1", zip: "28001" } : null }] } };
      throw new Error("consulta no esperada");
    },
  };
}

test("Puesta en marcha: webhooks idempotentes, catálogo sin servicios ni borradores, diagnóstico real", async () => {
  const shopify = fakeShopify();
  const app = makeApp({ demo: false, shopify });
  app.config.publicUrl = "https://ops.example.com";
  app.config.shopify.configured = true;
  let r = await ensureWebhooks(app.db, app.config, shopify);
  assert.deepEqual(r.created, ["ORDERS_PAID", "ORDERS_CANCELLED"]);
  r = await ensureWebhooks(app.db, app.config, shopify);
  assert.deepEqual(r.created, [], "la segunda vez no duplica");

  const c = await syncCatalog(app.db, shopify);
  assert.deepEqual([c.added, c.skipped], [1, 1]);
  assert.equal(app.db.get("SELECT unit_cost FROM supplier_products WHERE shopify_variant_id='gid://shopify/ProductVariant/9001'").unit_cost, 8.4);
  assert.equal(app.db.get("SELECT count(*) n FROM supplier_products WHERE shopify_variant_id IN ('gid://shopify/ProductVariant/9002','gid://shopify/ProductVariant/9003')").n, 0);

  let d = await diagnostics(app);
  const by = (id) => d.checks.find((x) => x.id === id);
  assert.equal(by("shopify").ok, true);
  assert.equal(by("scopes").ok, true);
  assert.equal(by("pii").ok, true);
  assert.equal(by("webhooks").ok, true);
  assert.equal(by("catalog").ok, false, "la variante nueva no tiene proveedor");

  const noPii = makeApp({ demo: false, shopify: fakeShopify({ withAddress: false, scopes: ["read_orders"] }) });
  noPii.config.shopify.configured = true;
  d = await diagnostics(noPii);
  assert.equal(d.checks.find((x) => x.id === "pii").ok, false);
  assert.match(d.checks.find((x) => x.id === "scopes").detail, /write_merchant_managed_fulfillment_orders/);
  assert.equal(d.ready, false);
});

test("Si la acción aprobada falla, la aprobación vuelve a quedar pendiente", async () => {
  const app = makeApp();
  const { id } = app.orders.ingestPaidOrder(normalizeOrderWebhook(demoOrderPayload(2020)));
  await app.queue.runDue();
  await app.orders.receiveSupplierMessage({ text: "Sí hay, 11€ total con envío", orderId: id });
  const ap = app.db.get("SELECT id FROM approvals WHERE order_id=? AND status='pendiente'", id);
  app.db.run("UPDATE orders SET status='cancelado' WHERE id=?", id); // estado que no permite pedir
  await assert.rejects(() => app.orders.decideApproval(ap.id, "aprobar"));
  assert.equal(app.db.get("SELECT status FROM approvals WHERE id=?", ap.id).status, "pendiente");
});

test("Un segundo mensaje dudoso del proveedor actualiza la revisión pendiente (no se pierde)", async () => {
  const app = makeApp();
  const { id } = app.orders.ingestPaidOrder(normalizeOrderWebhook(demoOrderPayload(2021)));
  await app.queue.runDue();
  await app.orders.receiveSupplierMessage({ text: "hola", orderId: id });
  await app.orders.receiveSupplierMessage({ text: "te digo luego el precio", orderId: id });
  const rows = app.db.all("SELECT * FROM approvals WHERE order_id=? AND status='pendiente'", id);
  assert.equal(rows.length, 1);
  const d = JSON.parse(rows[0].details_json);
  assert.equal(d.text, "te digo luego el precio");
  assert.deepEqual(d.previous, ["hola"]);
});

test("WhatsApp entrante firmado: se responde al instante y se procesa en la cola, sin duplicados", async () => {
  const whatsapp = { sendText: async () => "wamid.T", sendConsultaTemplate: async () => "wamid.P1" };
  const shopify = { getOrderPaymentStatus: async () => ({ displayFinancialStatus: "PAID" }) };
  const app = makeApp({ demo: false, whatsappApi: true, whatsapp, shopify });
  const { id } = app.orders.ingestPaidOrder(normalizeOrderWebhook(demoOrderPayload(2022, { test: false })));
  await app.queue.runDue(); await app.queue.runDue();
  const server = createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const body = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: "wamid.IN9", from: "34600000000", timestamp: "1", type: "text", text: { body: "#2022 Sí hay, 10€ total con envío, 2 días" } }] } }] }] });
    const sig = "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(body).digest("hex");
    for (let i = 0; i < 2; i++) {
      const r = await fetch(base + "/webhooks/whatsapp", { method: "POST", headers: { "X-Hub-Signature-256": sig }, body });
      assert.equal(r.status, 200);
    }
    await app.queue.runDue();
    const o = order(app, id);
    assert.equal(o.status, "pendiente_autorizacion");
    assert.equal(o.supplier_total_cost, 10);
    assert.equal(app.db.get("SELECT count(*) n FROM messages WHERE direction='in'").n, 1, "el reenvío de Meta no duplica");
  } finally { server.close(); app.stop(); }
});

test("Reprocesar tras asignar el proveedor en el catálogo funciona", async () => {
  const app = makeApp();
  const r = app.orders.ingestPaidOrder(normalizeOrderWebhook(demoOrderPayload(2030, { variant: 4242, sku: null, title: "Nuevo producto", variantTitle: null })));
  await app.queue.runDue();
  assert.equal(order(app, r.id).status, "incidencia");
  const sid = app.db.get("SELECT id FROM suppliers").id;
  app.db.run("INSERT INTO supplier_products(shopify_variant_id, title, supplier_id, unit_cost) VALUES('gid://shopify/ProductVariant/4242','Nuevo producto',?,5)", sid);
  await app.orders.resumeOrder(r.id);
  await app.queue.runDue();
  assert.equal(order(app, r.id).status, "pendiente_consulta");
});

test("Pedir seguimiento varias veces no rompe nada", async () => {
  const app = makeApp();
  const { id } = app.orders.ingestPaidOrder(normalizeOrderWebhook(demoOrderPayload(2031)));
  await app.queue.runDue();
  app.db.run("UPDATE orders SET status='solicitado_proveedor' WHERE id=?", id);
  await app.orders.requestTracking(id);
  await app.orders.requestTracking(id);
  assert.equal(app.db.get("SELECT count(*) n FROM messages WHERE order_id=? AND kind='seguimiento'", id).n, 2);
});

test("Los pedidos de prueba de Shopify nunca salen por la API y van marcados", async () => {
  const sent = [];
  const whatsapp = { sendText: async (...a) => { sent.push(a); return "w"; }, sendConsultaTemplate: async (...a) => { sent.push(a); return "w"; } };
  const shopify = { getOrderPaymentStatus: async () => ({ displayFinancialStatus: "PAID" }) };
  const app = makeApp({ demo: false, whatsappApi: true, whatsapp, shopify });
  const { id } = app.orders.ingestPaidOrder(normalizeOrderWebhook(demoOrderPayload(2032))); // test: true
  await app.queue.runDue(); await app.queue.runDue();
  assert.equal(sent.length, 0);
  const m = app.db.get("SELECT * FROM messages WHERE order_id=?", id);
  assert.equal(m.channel, "whatsapp_manual");
  assert.match(m.body, /PEDIDO DE PRUEBA/);
});

// ---------- Modo directo (por defecto): el proveedor tiene stock y envía ----------
test("Modo directo: pedido pagado → mensaje al proveedor con datos de envío → seguimiento → Shopify", async () => {
  const app = makeApp({ settings: { order_flow: "directo" } });
  const { id } = app.orders.ingestPaidOrder(normalizeOrderWebhook(demoOrderPayload(3100)));
  await app.queue.runDue();
  let o = order(app, id);
  assert.equal(o.status, "solicitado_proveedor");
  assert.equal(o.supplier_total_cost, 8.4 + 3.5, "coste estimado con el catálogo");
  assert.equal(app.db.get("SELECT count(*) n FROM approvals").n, 0, "sin aprobaciones por defecto");
  const m = app.db.get("SELECT * FROM messages WHERE order_id = ?", id);
  assert.equal(m.kind, "pedido");
  for (const re of [/Referencia: #3100/, /Calora/, /Cantidad: 1/, /Lucía Demo/, /Calle Falsa 123/, /28001 Madrid/, /Teléfono: \+34 600 000 001/, /seguimiento/])
    assert.match(m.body, re);
  assert.doesNotMatch(m.body, /example\.com/, "el email del cliente no se comparte");
  app.orders.markManualSent(m.id);

  await app.orders.receiveSupplierMessage({ text: "Recibido, gracias", orderId: id });
  assert.equal(order(app, id).status, "confirmado_proveedor");
  await app.orders.receiveSupplierMessage({ text: "Enviado por Correos: PK123456785ES", orderId: id });
  const ap = app.db.get("SELECT id FROM approvals WHERE order_id=? AND type='seguimiento'", id);
  await app.orders.decideApproval(ap.id, "aprobar");
  await app.queue.runDue();
  o = order(app, id);
  assert.equal(o.status, "enviado");
  assert.equal(o.tracking_number, "PK123456785ES");
});

test("Modo directo con aprobación previa opcional", async () => {
  const app = makeApp({ settings: { order_flow: "directo", direct_requires_approval: true } });
  const { id } = app.orders.ingestPaidOrder(normalizeOrderWebhook(demoOrderPayload(3101)));
  await app.queue.runDue();
  assert.equal(order(app, id).status, "pendiente_autorizacion");
  assert.equal(app.db.get("SELECT count(*) n FROM messages WHERE order_id=?", id).n, 0);
  const ap = app.db.get("SELECT id FROM approvals WHERE order_id=?", id);
  await app.orders.decideApproval(ap.id, "aprobar");
  assert.equal(order(app, id).status, "solicitado_proveedor");
  assert.match(app.db.get("SELECT body FROM messages WHERE order_id=?", id).body, /tengo un pedido nuevo para enviar/);
});

test("Modo directo sin dirección: no se envía nada e incidencia", async () => {
  const app = makeApp({ settings: { order_flow: "directo" } });
  const p = demoOrderPayload(3102); delete p.shipping_address;
  const { id } = app.orders.ingestPaidOrder(normalizeOrderWebhook(p));
  await app.queue.runDue();
  assert.equal(order(app, id).status, "incidencia");
  assert.equal(app.db.get("SELECT count(*) n FROM messages WHERE order_id=?", id).n, 0);
});

test("Modo directo por API: fuera de la ventana de 24 h usa la plantilla de pedido con los datos de envío", async () => {
  const sent = [];
  const whatsapp = {
    sendText: async (to, text) => { sent.push({ type: "text", text }); return "wamid.T"; },
    sendPedidoTemplate: async (to, ref, items, shipping) => { sent.push({ type: "pedido", ref, items, shipping }); return "wamid.P"; },
    sendConsultaTemplate: async () => { throw new Error("no debería consultar"); },
  };
  const shopify = { getOrderPaymentStatus: async () => ({ displayFinancialStatus: "PAID" }) };
  const app = makeApp({ demo: false, whatsappApi: true, whatsapp, shopify, settings: { order_flow: "directo" } });
  const { id } = app.orders.ingestPaidOrder(normalizeOrderWebhook(demoOrderPayload(3103, { test: false })));
  await app.queue.runDue(); await app.queue.runDue();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "pedido");
  assert.equal(sent[0].ref, "#3103");
  assert.match(sent[0].items, /Calora.*x1/);
  assert.match(sent[0].shipping, /Calle Falsa 123/);
  assert.equal(app.db.get("SELECT status FROM messages WHERE order_id=?", id).status, "enviado");

  await app.orders.receiveSupplierMessage({ from: "34600000000", text: "No me queda, lo siento", waId: "in1" });
  assert.equal(order(app, id).status, "incidencia");
});
