// Servidor HTTP sin dependencias: webhooks (Shopify, WhatsApp), API del panel y archivos del panel.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, validateConfig } from "./config.js";
import { createApp } from "./app.js";
import { audit } from "./audit.js";
import { verifyShopifyHmac, verifyMetaSignature, signSession, verifySession, safeEqual, randomId } from "./util/crypto.js";
import { normalizeOrderWebhook } from "./shopify/orders.js";
import { parseWhatsAppWebhook } from "./whatsapp/cloud.js";
import { orderEconomics, periodSummary } from "./finance.js";
import { agentsStatus, runDailyReport, dailyReport, localDate } from "./director.js";
import { STATES } from "./orders/states.js";
import { DEFAULT_SETTINGS } from "./orders/service.js";
import { diagnostics, ensureWebhooks } from "./setup.js";
import { syncCatalog } from "./shopify/catalog.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const MAX_BODY = 1024 * 1024;

export function createServer(app) {
  const { config, db, orders } = app;
  const sessionSecret = config.sessionSecret || (config.demo ? "demo-" + randomId() + randomId() : null);
  const loginAttempts = new Map();

  const send = (res, code, body, headers = {}) => {
    const isObj = typeof body === "object" && !(body instanceof Buffer);
    res.writeHead(code, {
      "Content-Type": isObj ? "application/json; charset=utf-8" : headers["Content-Type"] || "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      ...headers,
    });
    res.end(isObj ? JSON.stringify(body) : body);
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(Object.assign(new Error("Cuerpo demasiado grande"), { status: 413 })); req.destroy(); }
        else chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });

  const cookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=").map(decodeURIComponent)).filter((p) => p[0]));
  const authed = (req) => verifySession(sessionSecret, cookies(req).ops_session);
  const secureCookie = config.publicUrl.startsWith("https") ? "; Secure" : "";

  async function handle(req, res) {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    const method = req.method;

    if (p === "/health") return send(res, 200, { ok: true, demo: config.demo, time: new Date().toISOString() });

    // ---------- Webhooks de Shopify ----------
    if (p === "/webhooks/shopify" && method === "POST") {
      const raw = await readBody(req);
      if (!verifyShopifyHmac(raw, req.headers["x-shopify-hmac-sha256"], config.shopify.clientSecret)) {
        audit(db, { action: "webhook.shopify", result: "bloqueado", details: { reason: "HMAC no válido" } });
        return send(res, 401, "HMAC no válido");
      }
      const topic = String(req.headers["x-shopify-topic"] || "");
      const eventId = String(req.headers["x-shopify-webhook-id"] || req.headers["x-shopify-event-id"] || "");
      if (eventId) {
        const r = db.run("INSERT INTO webhook_events(source, event_id, topic) VALUES('shopify', ?, ?) ON CONFLICT DO NOTHING", eventId, topic);
        if (!r.changes) return send(res, 200, "duplicado");
      }
      const body = JSON.parse(raw.toString("utf8"));
      if (topic === "orders/paid") orders.ingestPaidOrder(normalizeOrderWebhook(body));
      else if (topic === "orders/cancelled") await orders.handleCancelled(body.admin_graphql_api_id || `gid://shopify/Order/${body.id}`);
      else if (topic === "customers/redact") {
        // RGPD: el cliente pide borrar sus datos.
        const ids = (body.orders_to_redact || []).map((id) => `gid://shopify/Order/${id}`);
        for (const id of ids) db.run("UPDATE orders SET customer_name=NULL, customer_email=NULL, ship_name=NULL, ship_address1=NULL, ship_address2=NULL, ship_zip=NULL, ship_city=NULL, ship_province=NULL, ship_phone=NULL, pii_purged_at=datetime('now') WHERE shopify_order_id = ?", id);
        audit(db, { action: "rgpd.redact", details: { orders: ids.length } });
      }
      return send(res, 200, "ok");
    }

    // ---------- Webhooks de WhatsApp (Cloud API) ----------
    if (p === "/webhooks/whatsapp" && method === "GET") {
      const ok = url.searchParams.get("hub.mode") === "subscribe" && config.whatsapp.verifyToken &&
        safeEqual(url.searchParams.get("hub.verify_token"), config.whatsapp.verifyToken);
      return ok ? send(res, 200, url.searchParams.get("hub.challenge") || "") : send(res, 403, "no");
    }
    if (p === "/webhooks/whatsapp" && method === "POST") {
      const raw = await readBody(req);
      if (!verifyMetaSignature(raw, req.headers["x-hub-signature-256"], config.whatsapp.appSecret)) {
        audit(db, { action: "webhook.whatsapp", result: "bloqueado", details: { reason: "firma no válida" } });
        return send(res, 401, "firma no válida");
      }
      const { messages, statuses } = parseWhatsAppWebhook(JSON.parse(raw.toString("utf8")));
      for (const s of statuses) {
        const st = { sent: "enviado", delivered: "entregado", read: "leido", failed: "fallido" }[s.status];
        if (st) db.run("UPDATE messages SET status = ? WHERE wa_message_id = ? AND direction = 'out' AND status != 'fallido'", st, s.id);
        if (s.status === "failed") await app.alert("error", "WhatsApp no pudo entregar un mensaje al proveedor", JSON.stringify(s.errors || "").slice(0, 300));
      }
      for (const m of messages) {
        const r = db.run("INSERT INTO webhook_events(source, event_id, topic) VALUES('whatsapp', ?, 'message') ON CONFLICT DO NOTHING", m.id);
        if (!r.changes) continue;
        if (!m.text) { await app.alert("aviso", "El proveedor envió un mensaje no textual", `Tipo: ${m.type}. Revísalo en WhatsApp.`); continue; }
        app.queue.enqueue("whatsapp.incoming", { from: m.from, text: m.text, waId: m.id, contextId: m.contextId }, { dedupeKey: `wa.in:${m.id}` });
      }
      return send(res, 200, "ok");
    }

    // ---------- Panel ----------
    if (p === "/" ) return send(res, 302, "", { Location: "/panel" });
    if (p === "/panel" || p.startsWith("/panel/")) {
      const file = p === "/panel" ? "panel.html" : p.slice("/panel/".length);
      const full = path.join(PUBLIC_DIR, path.normalize(file).replace(/^(\.\.[/\\])+/, ""));
      if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full)) return send(res, 404, "No encontrado");
      const type = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/manifest+json" }[path.extname(full)] || "application/octet-stream";
      return send(res, 200, fs.readFileSync(full), {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      });
    }

    // ---------- API del panel ----------
    if (!p.startsWith("/api/")) return send(res, 404, "No encontrado");

    if (p === "/api/login" && method === "POST") {
      const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
      const a = loginAttempts.get(ip) || { n: 0, t: Date.now() };
      if (Date.now() - a.t > 15 * 60 * 1000) { a.n = 0; a.t = Date.now(); }
      if (a.n >= 5) return send(res, 429, { error: "Demasiados intentos. Espera 15 minutos." });
      const { password } = JSON.parse((await readBody(req)).toString() || "{}");
      const ok = config.demo && !config.panelPassword ? true : !!config.panelPassword && safeEqual(password, config.panelPassword);
      if (!ok) { a.n++; loginAttempts.set(ip, a); audit(db, { actor: "propietario", action: "panel.login", result: "error" }); return send(res, 401, { error: "Contraseña incorrecta" }); }
      loginAttempts.delete(ip);
      audit(db, { actor: "propietario", action: "panel.login" });
      return send(res, 200, { ok: true }, { "Set-Cookie": `ops_session=${signSession(sessionSecret)}; HttpOnly; SameSite=Strict; Path=/${secureCookie}; Max-Age=43200` });
    }
    if (p === "/api/logout" && method === "POST") return send(res, 200, { ok: true }, { "Set-Cookie": `ops_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureCookie}` });
    if (!authed(req)) return send(res, 401, { error: "No autenticado" });
    // Protección CSRF: las peticiones que cambian algo deben venir del propio panel.
    if (method !== "GET" && req.headers["x-requested-with"] !== "ops-panel") return send(res, 403, { error: "Petición no permitida" });

    const json = async () => JSON.parse((await readBody(req)).toString() || "{}");
    const id = (re) => Number((p.match(re) || [])[1]);

    if (method === "GET" && p === "/api/summary") {
      const today = localDate(config.timezone);
      const tomorrow = new Date(Date.parse(today + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
      return send(res, 200, {
        demo: config.demo,
        paused: db.setting("automation_paused", false),
        today: periodSummary(db, config, today, tomorrow),
        month: periodSummary(db, config, today.slice(0, 8) + "01", tomorrow),
        byStatus: Object.fromEntries(db.all("SELECT status, count(*) n FROM orders GROUP BY status").map((r) => [r.status, r.n])),
        pendingApprovals: db.get("SELECT count(*) n FROM approvals WHERE status='pendiente'").n,
        unreadAlerts: db.get("SELECT count(*) n FROM alerts WHERE read=0").n,
        failedJobs: db.get("SELECT count(*) n FROM jobs WHERE status='fallido'").n,
        integrations: {
          shopify: config.shopify.configured ? "conectado" : config.demo ? "demo" : "sin conectar",
          whatsapp: config.whatsapp.apiConfigured ? "API oficial" : "semiautomático",
          claude: config.claude.configured ? "conectado" : "sin conectar (se usan reglas)",
          alertas: config.alerts.ntfyTopic ? "ntfy" : "solo panel",
          publicidad: "sin conectar",
        },
        states: STATES,
      });
    }
    if (method === "GET" && p === "/api/orders") {
      const status = url.searchParams.get("status");
      const rows = status
        ? db.all("SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT 200", status)
        : db.all("SELECT * FROM orders ORDER BY created_at DESC LIMIT 200");
      return send(res, 200, rows.map((o) => ({ ...o, economics: orderEconomics(db, config, o), items: orders.getItems(o.id) })));
    }
    if (method === "GET" && /^\/api\/orders\/\d+$/.test(p)) {
      const o = orders.getOrder(id(/(\d+)$/));
      if (!o) return send(res, 404, { error: "No existe" });
      return send(res, 200, {
        ...o,
        items: orders.getItems(o.id),
        economics: orderEconomics(db, config, o),
        messages: db.all("SELECT * FROM messages WHERE order_id = ? ORDER BY id", o.id).map((m) => ({ ...m, link: m.direction === "out" && m.status === "listo_para_enviar" && m.channel === "whatsapp_manual" ? orders.messageLink(m.id) : null })),
        approvals: db.all("SELECT * FROM approvals WHERE order_id = ? ORDER BY id DESC", o.id),
        history: db.all("SELECT at, actor, action, result, details_json FROM audit_log WHERE entity='order' AND entity_id = ? ORDER BY id", o.name),
      });
    }
    if (method === "POST" && /^\/api\/orders\/\d+\/reply$/.test(p)) {
      const { text } = await json();
      if (!text?.trim()) return send(res, 400, { error: "Pega el mensaje del proveedor" });
      const r = await orders.receiveSupplierMessage({ text: text.trim(), orderId: id(/orders\/(\d+)/), channel: "whatsapp_manual", actor: "propietario" });
      return send(res, 200, r);
    }
    if (method === "POST" && /^\/api\/orders\/\d+\/resume$/.test(p)) { const b = await json(); await orders.resumeOrder(id(/orders\/(\d+)/), b.to || null); return send(res, 200, { ok: true }); }
    if (method === "POST" && /^\/api\/orders\/\d+\/request-tracking$/.test(p)) { await orders.requestTracking(id(/orders\/(\d+)/)); return send(res, 200, { ok: true }); }
    if (method === "POST" && /^\/api\/orders\/\d+\/delivered$/.test(p)) { orders.markDelivered(id(/orders\/(\d+)/)); return send(res, 200, { ok: true }); }

    if (method === "GET" && /^\/api\/messages\/\d+\/link$/.test(p)) return send(res, 200, { link: orders.messageLink(id(/messages\/(\d+)/)) });
    if (method === "POST" && /^\/api\/messages\/\d+\/sent$/.test(p)) return send(res, 200, orders.markManualSent(id(/messages\/(\d+)/)));
    if (method === "POST" && /^\/api\/messages\/\d+\/retry$/.test(p)) {
      const mid = id(/messages\/(\d+)/);
      db.run("UPDATE messages SET status = 'borrador' WHERE id = ? AND status = 'fallido'", mid);
      app.queue.enqueue("message.send", { messageId: mid }, { dedupeKey: `message.send.manualretry:${mid}:${Date.now()}` });
      audit(db, { actor: "propietario", action: "proveedor.reenviar", entity: "message", entityId: mid });
      return send(res, 200, { ok: true });
    }

    if (method === "GET" && p === "/api/approvals") {
      const status = url.searchParams.get("status") || "pendiente";
      return send(res, 200, db.all(
        "SELECT a.*, o.name AS order_name FROM approvals a LEFT JOIN orders o ON o.id = a.order_id WHERE a.status = ? ORDER BY a.id DESC LIMIT 200", status
      ));
    }
    if (method === "POST" && /^\/api\/approvals\/\d+$/.test(p)) {
      const b = await json();
      if (!["aprobar", "rechazar"].includes(b.decision)) return send(res, 400, { error: "Decisión no válida" });
      await orders.decideApproval(id(/(\d+)$/), b.decision, { note: b.note || null, overrides: b.overrides || {} });
      return send(res, 200, { ok: true });
    }

    if (method === "GET" && p === "/api/alerts") return send(res, 200, db.all("SELECT * FROM alerts ORDER BY id DESC LIMIT 100"));
    if (method === "POST" && p === "/api/alerts/read") { db.run("UPDATE alerts SET read = 1 WHERE read = 0"); return send(res, 200, { ok: true }); }
    if (method === "GET" && p === "/api/audit") return send(res, 200, db.all("SELECT * FROM audit_log ORDER BY id DESC LIMIT 300"));
    if (method === "GET" && p === "/api/agents") return send(res, 200, agentsStatus(db, config));
    if (method === "GET" && p === "/api/jobs") return send(res, 200, db.all("SELECT id, type, status, attempts, last_error, run_at, updated_at FROM jobs WHERE type != 'noop' ORDER BY id DESC LIMIT 100"));

    // ---------- Puesta en marcha ----------
    if (method === "GET" && p === "/api/diagnostics") return send(res, 200, await diagnostics(app));
    if (method === "POST" && p === "/api/setup/webhooks") {
      if (!app.shopify) return send(res, 400, { error: "Shopify no está conectado" });
      return send(res, 200, await ensureWebhooks(db, config, app.shopify));
    }
    if (method === "POST" && p === "/api/setup/sync-catalog") {
      if (!app.shopify) return send(res, 400, { error: "Shopify no está conectado" });
      return send(res, 200, await syncCatalog(db, app.shopify));
    }
    if (method === "POST" && p === "/api/setup/test-alert") {
      await app.alert("info", "Alerta de prueba", "Si ves esto en el móvil, las alertas funcionan.");
      return send(res, 200, { ok: true, ntfy: !!config.alerts.ntfyTopic });
    }
    if (method === "POST" && p === "/api/catalog/assign-all") {
      const { supplier_id } = await json();
      if (!db.get("SELECT id FROM suppliers WHERE id = ?", supplier_id)) return send(res, 400, { error: "Proveedor no válido" });
      const r = db.run("UPDATE supplier_products SET supplier_id = ?, updated_at = datetime('now') WHERE supplier_id IS NULL", supplier_id);
      audit(db, { actor: "propietario", action: "catalogo.asignar_todo", details: { supplier_id, rows: r.changes } });
      return send(res, 200, { ok: true, updated: r.changes });
    }

    if (method === "GET" && p === "/api/suppliers") return send(res, 200, db.all("SELECT * FROM suppliers ORDER BY id"));
    if (method === "POST" && p === "/api/suppliers") {
      const b = await json();
      const phone = String(b.whatsapp || "").replace(/\D/g, "");
      if (!b.name || phone.length < 9) return send(res, 400, { error: "Nombre y WhatsApp (con prefijo de país) obligatorios" });
      if (b.id) db.run("UPDATE suppliers SET name=?, whatsapp=?, active=? WHERE id=?", b.name, phone, b.active === false ? 0 : 1, b.id);
      else db.run("INSERT INTO suppliers(name, whatsapp) VALUES(?, ?)", b.name, phone);
      if (b.consent) db.run("UPDATE suppliers SET consent_at = coalesce(consent_at, datetime('now')), consent_note = ? WHERE whatsapp = ?", String(b.consent_note || "Aceptado por el proveedor").slice(0, 300), phone);
      audit(db, { actor: "propietario", action: "proveedor.guardar", details: { name: b.name, consent: !!b.consent } });
      return send(res, 200, { ok: true });
    }

    if (method === "GET" && p === "/api/catalog") return send(res, 200, db.all("SELECT sp.*, s.name AS supplier_name FROM supplier_products sp LEFT JOIN suppliers s ON s.id = sp.supplier_id ORDER BY sp.title, sp.variant_title"));
    if (method === "POST" && p === "/api/catalog") {
      const b = await json();
      const num = (v) => (v === "" || v == null ? null : Number(String(v).replace(",", ".")));
      if (!b.id) return send(res, 400, { error: "Falta id" });
      db.run(
        "UPDATE supplier_products SET supplier_id=?, supplier_ref=?, unit_cost=?, shipping_cost=?, auto_order=?, auto_max_amount=?, updated_at=datetime('now') WHERE id=?",
        b.supplier_id || null, b.supplier_ref || null, num(b.unit_cost), num(b.shipping_cost), b.auto_order ? 1 : 0, num(b.auto_max_amount), b.id
      );
      audit(db, { actor: "propietario", action: "catalogo.editar", entity: "supplier_product", entityId: b.id, details: { unit_cost: num(b.unit_cost), auto_order: !!b.auto_order } });
      return send(res, 200, { ok: true });
    }

    if (method === "GET" && p === "/api/settings") return send(res, 200, Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((k) => [k, db.setting(k, DEFAULT_SETTINGS[k])])));
    if (method === "POST" && p === "/api/settings") {
      const b = await json();
      for (const [k, v] of Object.entries(b)) {
        if (!(k in DEFAULT_SETTINGS)) continue;
        const def = DEFAULT_SETTINGS[k];
        const val = typeof def === "boolean" ? !!v : typeof def === "number" ? Number(v) : String(v);
        if (typeof def === "number" && !Number.isFinite(val)) continue;
        db.setSetting(k, val);
        audit(db, { actor: "propietario", action: "ajuste.cambiar", details: { key: k, value: val } });
      }
      return send(res, 200, { ok: true });
    }
    if (method === "POST" && p === "/api/pause") {
      const { paused } = await json();
      db.setSetting("automation_paused", !!paused);
      audit(db, { actor: "propietario", action: paused ? "automatizaciones.pausar" : "automatizaciones.reanudar" });
      await app.alert(paused ? "aviso" : "info", paused ? "Automatizaciones en pausa" : "Automatizaciones reanudadas");
      return send(res, 200, { ok: true, paused: !!paused });
    }
    if (method === "POST" && p === "/api/ad-spend") {
      const b = await json();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.day || "") || !(Number(b.amount) >= 0)) return send(res, 400, { error: "Fecha (AAAA-MM-DD) e importe obligatorios" });
      db.run("INSERT INTO ad_spend(day, platform, amount) VALUES(?,?,?) ON CONFLICT(day, platform) DO UPDATE SET amount = excluded.amount", b.day, b.platform || "meta", Number(b.amount));
      audit(db, { actor: "propietario", action: "publicidad.gasto", details: b });
      return send(res, 200, { ok: true });
    }
    if (method === "GET" && p === "/api/reports") return send(res, 200, db.all("SELECT * FROM reports ORDER BY period DESC LIMIT 30").map((r) => ({ ...r, data: JSON.parse(r.data_json) })));
    if (method === "POST" && p === "/api/reports/run") return send(res, 200, await runDailyReport(db, config, app.alert, (await json()).day || null));
    if (method === "GET" && p === "/api/reports/today") return send(res, 200, dailyReport(db, config, localDate(config.timezone)));

    // Atención al cliente: solo información verificada del pedido (para el futuro agente de chat/correo).
    if (method === "GET" && p === "/api/customer/order-status") {
      const o = db.get("SELECT * FROM orders WHERE name = ?", url.searchParams.get("name") || "");
      if (!o) return send(res, 404, { error: "Pedido no encontrado" });
      return send(res, 200, {
        name: o.name, estado: STATES[o.status],
        seguimiento: o.tracking_number ? { numero: o.tracking_number, empresa: o.tracking_company, url: o.tracking_url } : null,
        plazo_confirmado_dias: o.status === "enviado" || o.status === "confirmado_proveedor" || o.status === "preparando_envio" ? o.supplier_eta_days : null,
        incidencia_abierta: o.status === "incidencia",
        nota: "Comunica solo estos datos. Si no hay seguimiento, no des fechas.",
      });
    }

    if (config.demo && method === "POST" && p === "/api/demo/order") {
      const { demoOrderPayload } = await import("../scripts/demo-data.js");
      const n = 1000 + Math.floor(Math.random() * 9000);
      const r = orders.ingestPaidOrder(normalizeOrderWebhook(demoOrderPayload(n)), { source: "demo" });
      await app.queue.runDue();
      return send(res, 200, r);
    }
    if (config.demo && method === "POST" && p === "/api/demo/run-queue") return send(res, 200, { done: await app.queue.runDue() });

    return send(res, 404, { error: "Ruta no encontrada" });
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      audit(db, { action: "http.error", result: "error", details: { path: req.url?.split("?")[0], error: String(e.message || e).slice(0, 300) } });
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : "Error interno: " + String(e.message || e).slice(0, 200) });
    });
  });
}

// Arranque directo: node src/server.js
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const problems = validateConfig(config);
  if (problems.length) {
    console.error("No se puede arrancar:\n - " + problems.join("\n - "));
    process.exit(1);
  }
  const app = createApp(config);
  if (config.demo) {
    const { seedDemo } = await import("../scripts/demo-data.js");
    seedDemo(app.db);
  }
  app.startScheduler();
  const server = createServer(app);
  server.listen(config.port, () => console.log(`Palazzo Ops en ${config.publicUrl} (puerto ${config.port})${config.demo ? " · MODO DEMO" : ""}`));
  const shutdown = () => { app.stop(); server.close(() => process.exit(0)); };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
