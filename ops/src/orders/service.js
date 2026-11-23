// Agente de pedidos y proveedor: el corazón del sistema.
// Flujo: pedido pagado -> consulta al proveedor (sin datos personales) -> respuesta interpretada
// -> aprobación (o regla automática) -> pedido con dirección -> seguimiento verificado -> Shopify.
import { audit } from "../audit.js";
import { canTransition, STATES, SUPPLIER_HAS_ORDER } from "./states.js";
import { buildConsultaMessage, buildPedidoMessage, buildSeguimientoMessage, waLink } from "../whatsapp/messages.js";
import { parseSupplierReply } from "../ai/parser.js";
import { classifyTracking, trackingUrl } from "../tracking.js";
import { orderEconomics } from "../finance.js";

export const DEFAULT_SETTINGS = {
  automation_paused: false,
  auto_purchase_enabled: false,       // compras automáticas al proveedor (fase 4, tú lo activas)
  auto_tracking_to_shopify: false,    // subir seguimiento a Shopify sin aprobación (si es fiable)
  min_margin_percent: 20,             // por debajo, siempre pide aprobación y avisa
  vat_percent: 21,                    // IVA incluido en tus precios de venta
  service_item_pattern: "env[ií]o (r[aá]pido|protegido)|fast shipping|protected shipment|seguro de env[ií]o",
  hours_no_reply_alert: 12,
  hours_no_tracking_alert: 72,
  days_shipped_check: 15,
};

export function createOrderService({ db, config, shopify, whatsapp, queue, alert, fetchImpl = globalThis.fetch }) {
  const S = (k) => db.setting(k, DEFAULT_SETTINGS[k]);
  const now = () => new Date().toISOString();

  // ---------- utilidades ----------
  const getOrder = (id) => db.get("SELECT * FROM orders WHERE id = ?", id);
  const getItems = (id) =>
    db.all(
      `SELECT oi.*, sp.supplier_ref, sp.unit_cost, sp.shipping_cost, sp.auto_order, sp.auto_max_amount, sp.supplier_id
       FROM order_items oi LEFT JOIN supplier_products sp ON sp.id = oi.supplier_product_id
       WHERE oi.order_id = ? ORDER BY oi.id`, id
    );
  const supplierOf = (o) => (o.supplier_id ? db.get("SELECT * FROM suppliers WHERE id = ?", o.supplier_id) : null);
  const isService = (title) => {
    try { return new RegExp(S("service_item_pattern"), "i").test(title || ""); } catch { return false; }
  };
  const physicalItems = (orderId) => getItems(orderId).filter((i) => !isService(i.title));

  function setStatus(order, to, { actor = "sistema", note = null, extra = {} } = {}) {
    if (!canTransition(order.status, to)) {
      audit(db, { actor, action: "pedido.estado", entity: "order", entityId: order.name, result: "bloqueado", details: { from: order.status, to } });
      throw Object.assign(new Error(`Transición no permitida: ${order.status} → ${to}`), { permanent: true });
    }
    const sets = ["status = ?", "updated_at = datetime('now')"];
    const vals = [to];
    for (const [k, v] of Object.entries(extra)) { sets.push(`${k} = ?`); vals.push(v); }
    db.run(`UPDATE orders SET ${sets.join(", ")} WHERE id = ?`, ...vals, order.id);
    audit(db, { actor, action: "pedido.estado", entity: "order", entityId: order.name, details: { from: order.status, to, note } });
    return getOrder(order.id);
  }

  async function raiseIncident(order, reason, { actor = "sistema", level = "aviso" } = {}) {
    const o = setStatus(order, "incidencia", { actor, note: reason, extra: { incident: reason } });
    await alert(level, `Incidencia en ${order.name}`, reason, order.id);
    return o;
  }

  function createApproval(type, order, title, details, amount = null) {
    const r = db.run(
      `INSERT INTO approvals(type, order_id, title, details_json, amount) VALUES(?,?,?,?,?)
       ON CONFLICT DO NOTHING`, type, order?.id ?? null, title, JSON.stringify(details), amount
    );
    if (r.changes) audit(db, { action: "aprobacion.creada", entity: "approval", entityId: r.lastInsertRowid, details: { type, order: order?.name } });
    return r.changes > 0;
  }

  // ---------- 1. Entrada de pedidos (webhook orders/paid) ----------
  function ingestPaidOrder(o, { source = "webhook" } = {}) {
    if (o.test && !config.demo) audit(db, { action: "pedido.prueba", entity: "order", entityId: o.name, details: { note: "pedido de prueba de Shopify" } });
    return db.tx(() => {
      const exists = db.get("SELECT id FROM orders WHERE shopify_order_id = ?", o.shopifyOrderId);
      if (exists) {
        audit(db, { action: "pedido.duplicado", entity: "order", entityId: o.name, result: "omitido", details: { source } });
        return { id: exists.id, duplicate: true };
      }
      const r = db.run(
        `INSERT INTO orders(shopify_order_id, name, status, financial_status, currency, total_price, shipping_price,
          customer_name, customer_email, ship_name, ship_address1, ship_address2, ship_zip, ship_city, ship_province, ship_country, ship_phone, created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        o.shopifyOrderId, o.name, "nuevo", o.financialStatus, o.currency, o.totalPrice, o.shippingPrice,
        o.customer.name, o.customer.email, o.shipping.name, o.shipping.address1, o.shipping.address2, o.shipping.zip,
        o.shipping.city, o.shipping.province, o.shipping.country, o.shipping.phone, o.createdAt
      );
      const orderId = Number(r.lastInsertRowid);
      for (const it of o.items) {
        const sp =
          (it.variantId && db.get("SELECT * FROM supplier_products WHERE shopify_variant_id = ?", it.variantId)) ||
          (it.sku && db.get("SELECT * FROM supplier_products WHERE sku = ?", it.sku)) || null;
        db.run(
          `INSERT INTO order_items(order_id, shopify_line_item_id, shopify_variant_id, sku, title, variant_title, quantity, unit_price, supplier_product_id)
           VALUES(?,?,?,?,?,?,?,?,?)`,
          orderId, it.lineItemId, it.variantId, it.sku, it.title, it.variantTitle, it.quantity, it.unitPrice, sp?.id ?? null
        );
      }
      audit(db, { action: "pedido.recibido", entity: "order", entityId: o.name, details: { total: o.totalPrice, items: o.items.length, source } });
      queue.enqueue("order.process", { orderId }, { dedupeKey: `order.process:${orderId}` });
      return { id: orderId, duplicate: false };
    });
  }

  // ---------- 2. Procesar pedido: comprobar pago, proveedor y preparar la consulta ----------
  async function processOrder(orderId) {
    let order = getOrder(orderId);
    if (!order || order.status !== "nuevo") return;

    // Doble comprobación del pago contra Shopify (no nos fiamos solo del webhook).
    if (shopify && config.shopify.configured && !config.demo) {
      const so = await shopify.getOrderPaymentStatus(order.shopify_order_id);
      if (!so) return raiseIncident(order, "No se encontró el pedido en Shopify al verificar el pago");
      if (so.cancelledAt) return void setStatus(order, "cancelado", { note: "Cancelado en Shopify" });
      if (so.displayFinancialStatus !== "PAID") return raiseIncident(order, `El pago no está confirmado (estado: ${so.displayFinancialStatus})`);
      db.run("UPDATE orders SET financial_status = 'paid' WHERE id = ?", orderId);
    } else if (order.financial_status && order.financial_status !== "paid") {
      return raiseIncident(order, `El pago no está confirmado (estado: ${order.financial_status})`);
    }

    const items = physicalItems(orderId);
    if (!items.length) return raiseIncident(order, "El pedido no tiene productos físicos que pedir al proveedor");
    const unmapped = items.filter((i) => !i.supplier_product_id);
    if (unmapped.length)
      return raiseIncident(order, `Productos sin proveedor asignado: ${unmapped.map((i) => i.title + (i.variant_title ? ` (${i.variant_title})` : "")).join(", ")}. Asígnalos en Catálogo y reanuda el pedido.`);
    const supplierIds = [...new Set(items.map((i) => i.supplier_id).filter(Boolean))];
    if (supplierIds.length !== 1) return raiseIncident(order, "Los productos tienen proveedores distintos o sin proveedor; revísalo en Catálogo.");
    const supplier = db.get("SELECT * FROM suppliers WHERE id = ? AND active = 1", supplierIds[0]);
    if (!supplier) return raiseIncident(order, "El proveedor asignado no está activo");

    db.run("UPDATE orders SET supplier_id = ? WHERE id = ?", supplier.id, orderId);
    if (!order.ship_address1) await alert("error", `${order.name}: Shopify no ha enviado la dirección`, "Activa el acceso a datos protegidos del cliente en tu app del Dev Dashboard. Sin dirección no se podrá pedir al proveedor.", orderId);
    order = setStatus(getOrder(orderId), "pendiente_consulta");
    await sendToSupplier(order, "consulta", buildConsultaMessage(order, items));
  }

  // ---------- 3. Envío de mensajes al proveedor (API oficial o enlace manual) ----------
  async function sendToSupplier(order, kind, body, { actor = "sistema" } = {}) {
    const supplier = supplierOf(order);
    if (!supplier) throw Object.assign(new Error("Pedido sin proveedor"), { permanent: true });
    const useApi = !!(whatsapp && config.whatsapp.apiConfigured && supplier.consent_at && !config.demo);

    // Un mensaje saliente por tipo y pedido (salvo "seguimiento", que puede repetirse).
    const existing = kind === "seguimiento" ? null
      : db.get("SELECT * FROM messages WHERE order_id = ? AND kind = ? AND direction = 'out' AND status != 'fallido'", order.id, kind);
    if (existing) {
      audit(db, { actor, action: `proveedor.${kind}`, entity: "order", entityId: order.name, result: "omitido", details: { reason: "ya existe" } });
      return existing;
    }
    const ins = db.run(
      "INSERT INTO messages(order_id, supplier_id, direction, kind, channel, body, status) VALUES(?,?,?,?,?,?,?)",
      order.id, supplier.id, "out", kind, useApi ? "whatsapp_api" : "whatsapp_manual", body, useApi ? "borrador" : "listo_para_enviar"
    );
    const msgId = Number(ins.lastInsertRowid);

    if (!useApi) {
      audit(db, { actor, action: `proveedor.${kind}.preparado`, entity: "order", entityId: order.name, details: { channel: "manual" } });
      await alert("info", `${order.name}: mensaje listo para el proveedor`, `Abre el panel y pulsa "Enviar por WhatsApp" (${kind}).`, order.id);
      return db.get("SELECT * FROM messages WHERE id = ?", msgId);
    }
    if (db.setting("automation_paused", false)) {
      audit(db, { actor, action: `proveedor.${kind}`, entity: "order", entityId: order.name, result: "bloqueado", details: { reason: "automatizaciones en pausa" } });
      queue.enqueue("message.send", { messageId: msgId }, { dedupeKey: `message.send:${msgId}`, delaySec: 60 });
      return db.get("SELECT * FROM messages WHERE id = ?", msgId);
    }
    queue.enqueue("message.send", { messageId: msgId }, { dedupeKey: `message.send:${msgId}` });
    return db.get("SELECT * FROM messages WHERE id = ?", msgId);
  }

  // Tarea de la cola: enviar por la Cloud API (con plantilla si la ventana de 24 h está cerrada).
  async function sendQueuedMessage(messageId) {
    const m = db.get("SELECT * FROM messages WHERE id = ?", messageId);
    if (!m || m.status === "enviado") return;
    const order = getOrder(m.order_id);
    const supplier = db.get("SELECT * FROM suppliers WHERE id = ?", m.supplier_id);
    const lastIn = db.get("SELECT max(created_at) AS t FROM messages WHERE supplier_id = ? AND direction = 'in'", supplier.id)?.t;
    const windowOpen = lastIn && Date.now() - Date.parse(lastIn + "Z") < 23.5 * 3600 * 1000;
    let waId;
    try {
      const summary = physicalItems(order.id).map((i) => `${i.title}${i.variant_title ? " (" + i.variant_title + ")" : ""} x${i.quantity}${i.supplier_ref ? " ref " + i.supplier_ref : ""}`).join("; ");
      if (windowOpen) waId = await whatsapp.sendText(supplier.whatsapp, m.body);
      else if (m.kind === "consulta") waId = await whatsapp.sendConsultaTemplate(supplier.whatsapp, order.name, summary);
      else {
        // Fuera de ventana y no es una consulta: se reabre con la plantilla y el texto se manda al contestar.
        await whatsapp.sendConsultaTemplate(supplier.whatsapp, order.name, summary);
        db.run("UPDATE messages SET status = 'listo_para_enviar' WHERE id = ?", m.id);
        audit(db, { action: `proveedor.${m.kind}`, entity: "order", entityId: order.name, details: { note: "ventana cerrada: plantilla enviada, el detalle se enviará cuando responda" } });
        return;
      }
    } catch (e) {
      db.run("UPDATE messages SET status = 'fallido' WHERE id = ? AND status != 'enviado'", m.id);
      audit(db, { action: `proveedor.${m.kind}.envio`, entity: "order", entityId: order.name, result: "error", details: { error: e.message } });
      throw e;
    }
    db.run("UPDATE messages SET status = 'enviado', wa_message_id = ?, sent_at = datetime('now') WHERE id = ?", waId, m.id);
    db.run("UPDATE orders SET last_supplier_contact_at = datetime('now') WHERE id = ?", order.id);
    audit(db, { action: `proveedor.${m.kind}.enviado`, entity: "order", entityId: order.name, details: { channel: "api", template: !windowOpen } });
  }

  // Modo semiautomático: el propietario abrió WhatsApp y confirma que lo envió.
  function markManualSent(messageId, actor = "propietario") {
    const m = db.get("SELECT * FROM messages WHERE id = ? AND direction = 'out'", messageId);
    if (!m) throw new Error("Mensaje no encontrado");
    if (m.status === "enviado") return m;
    db.run("UPDATE messages SET status = 'enviado', sent_at = datetime('now') WHERE id = ?", messageId);
    db.run("UPDATE orders SET last_supplier_contact_at = datetime('now') WHERE id = ?", m.order_id);
    const o = getOrder(m.order_id);
    audit(db, { actor, action: `proveedor.${m.kind}.enviado`, entity: "order", entityId: o?.name, details: { channel: "manual" } });
    return db.get("SELECT * FROM messages WHERE id = ?", messageId);
  }

  function messageLink(messageId) {
    const m = db.get("SELECT m.*, s.whatsapp FROM messages m JOIN suppliers s ON s.id = m.supplier_id WHERE m.id = ?", messageId);
    return m ? waLink(m.whatsapp, m.body) : null;
  }

  // ---------- 4. Respuestas del proveedor ----------
  async function receiveSupplierMessage({ from, text, waId = null, contextId = null, channel = "whatsapp_api", orderId = null, actor = "sistema" }) {
    const supplier = from ? db.get("SELECT * FROM suppliers WHERE whatsapp = ?", String(from).replace(/\D/g, "")) : null;
    if (!supplier && !orderId) {
      audit(db, { action: "whatsapp.entrante", result: "omitido", details: { reason: "remitente que no es proveedor" } });
      return { ignored: true };
    }
    // Identificar el pedido: el que indica el panel, la referencia "#1234", el mensaje citado o el único abierto.
    let order = orderId ? getOrder(orderId) : null;
    const parsed = await parseSupplierReply(text, { config, fetchImpl });
    if (!order && parsed.orderRefs.length === 1) order = db.get("SELECT * FROM orders WHERE name = ? AND supplier_id = ?", parsed.orderRefs[0], supplier.id);
    if (!order && contextId) {
      const ref = db.get("SELECT order_id FROM messages WHERE wa_message_id = ?", contextId);
      if (ref) order = getOrder(ref.order_id);
    }
    if (!order) {
      const open = db.all(
        `SELECT * FROM orders WHERE supplier_id = ? AND status IN ('pendiente_consulta','solicitado_proveedor','confirmado_proveedor','preparando_envio')`,
        supplier.id
      );
      if (open.length === 1) order = open[0];
    }
    const sid = supplier?.id ?? order?.supplier_id;
    const ins = db.run(
      "INSERT INTO messages(order_id, supplier_id, direction, kind, channel, body, status, wa_message_id, parsed_json) VALUES(?,?,?,?,?,?,?,?,?)",
      order?.id ?? null, sid, "in", "respuesta", channel, text, "recibido", waId, JSON.stringify(parsed)
    );
    if (order) db.run("UPDATE orders SET last_supplier_contact_at = datetime('now') WHERE id = ?", order.id);

    // Si había un mensaje pendiente por la ventana de 24 h, ahora se puede enviar.
    let flushed = 0;
    if (sid && config.whatsapp.apiConfigured && !config.demo) {
      for (const p of db.all("SELECT id FROM messages WHERE supplier_id = ? AND direction='out' AND channel='whatsapp_api' AND status='listo_para_enviar'", sid)) {
        queue.enqueue("message.send", { messageId: p.id }, { dedupeKey: `message.send.retry:${p.id}:${ins.lastInsertRowid}` });
        flushed++;
      }
    }
    // Respuesta tipo "dime" a la plantilla de reapertura: no es una respuesta al pedido.
    if (flushed && parsed.ambiguous && !parsed.tracking) {
      audit(db, { action: "proveedor.reapertura", entity: "order", entityId: order?.name, details: { flushed } });
      return { orderId: order?.id ?? null, parsed, reopened: true };
    }

    if (!order) {
      createApproval("respuesta_ambigua", null, "Mensaje del proveedor sin pedido identificado", { text, parsed, messageId: Number(ins.lastInsertRowid) });
      await alert("aviso", "Mensaje del proveedor sin pedido", "No se ha podido asociar a ningún pedido. Revísalo en Aprobaciones.");
      return { orderId: null, parsed };
    }
    await applyParsed(order, parsed, { text, actor });
    return { orderId: order.id, parsed };
  }

  async function applyParsed(order, p, { text, actor = "sistema" }) {
    const ambiguousApproval = (why) =>
      createApproval("respuesta_ambigua", order, `${order.name}: respuesta del proveedor por revisar`, { text, parsed: p, why });

    if (p.problem && !p.tracking) {
      await raiseIncident(order, `El proveedor indica un problema: "${text.slice(0, 200)}"`, { actor });
      return;
    }

    switch (order.status) {
      case "pendiente_consulta": {
        if (p.available === false) return void (await raiseIncident(order, "El proveedor no tiene disponibilidad. Decide si buscar alternativa o reembolsar (el reembolso lo haces tú).", { actor }));
        if (p.ambiguous || p.available !== true) {
          ambiguousApproval(p.reasons.join(" · ") || "No está claro si hay disponibilidad");
          return void (await alert("aviso", `${order.name}: respuesta dudosa del proveedor`, "Revísala en Aprobaciones.", order.id));
        }
        const cost = supplierCostFrom(order, p);
        const o2 = setStatus(order, "disponibilidad_confirmada", {
          actor, extra: { supplier_available: 1, supplier_total_cost: cost.total, supplier_eta_days: p.etaDays },
        });
        return void (await decidePurchase(o2, cost));
      }
      case "solicitado_proveedor":
      case "confirmado_proveedor":
      case "preparando_envio": {
        if (p.tracking) return void (await handleTracking(order, p, { actor, text }));
        if (p.status === "preparando" && order.status !== "preparando_envio")
          return void setStatus(order, "preparando_envio", { actor, extra: { supplier_eta_days: p.etaDays ?? order.supplier_eta_days } });
        if ((p.status === "confirmado" || p.available === true) && order.status === "solicitado_proveedor")
          return void setStatus(order, "confirmado_proveedor", { actor, extra: { supplier_eta_days: p.etaDays ?? order.supplier_eta_days } });
        if (p.ambiguous) ambiguousApproval(p.reasons.join(" · ") || "Mensaje sin información clara");
        return;
      }
      default:
        audit(db, { actor, action: "proveedor.respuesta", entity: "order", entityId: order.name, result: "omitido", details: { status: order.status } });
    }
  }

  // Coste real según lo que dice el proveedor; si falta, coste del catálogo (marcado como no confirmado).
  function supplierCostFrom(order, p) {
    const items = physicalItems(order.id);
    const qty = items.reduce((a, i) => a + i.quantity, 0);
    const catalog = items.reduce((a, i) => a + (i.unit_cost ?? NaN) * i.quantity, 0) + Math.max(0, ...items.map((i) => i.shipping_cost ?? 0));
    if (p.price != null && p.priceIsTotal) return { total: p.price, source: "proveedor (total con envío)", confirmed: true };
    if (p.unitPrice != null) return { total: p.unitPrice * qty + (p.shippingPrice ?? 0), source: "proveedor (unidad + envío)", confirmed: p.shippingPrice != null };
    if (p.price != null) return { total: p.price, source: "proveedor (sin aclarar si incluye envío)", confirmed: false };
    return { total: Number.isFinite(catalog) ? catalog : null, source: "catálogo (no confirmado por el proveedor)", confirmed: false };
  }

  async function decidePurchase(order, cost) {
    const items = physicalItems(order.id);
    const econ = orderEconomics(db, config, order, { supplierCost: cost.total });
    const minMargin = Number(S("min_margin_percent"));
    const autoOk =
      S("auto_purchase_enabled") && !S("automation_paused") && cost.confirmed && cost.total != null &&
      items.every((i) => i.auto_order === 1 && i.auto_max_amount != null && cost.total <= i.auto_max_amount) &&
      econ.marginPercent != null && econ.marginPercent >= minMargin;

    if (autoOk) {
      audit(db, { action: "compra.automatica", entity: "order", entityId: order.name, details: { cost: cost.total, margin: econ.marginPercent } });
      return confirmPurchase(order, "sistema");
    }
    const lowMargin = econ.marginPercent != null && econ.marginPercent < minMargin;
    setStatus(order, "pendiente_autorizacion");
    createApproval("compra_proveedor", order, `Comprar ${order.name} al proveedor por ${fmt(cost.total)}`, {
      items: items.map((i) => ({ title: i.title, variant: i.variant_title, qty: i.quantity })),
      cost, etaDays: order.supplier_eta_days, economics: econ, lowMargin,
    }, cost.total);
    await alert(lowMargin ? "aviso" : "info", `${order.name}: compra pendiente de tu aprobación`,
      `Coste ${fmt(cost.total)} · margen estimado ${econ.marginPercent ?? "?"}%${lowMargin ? " (por debajo del mínimo)" : ""}`, order.id);
  }

  // Aprobada la compra: se envía al proveedor el pedido con la dirección de entrega.
  async function confirmPurchase(order, actor) {
    if (!order.ship_address1 || !order.ship_zip || !order.ship_name) {
      return raiseIncident(order, "Faltan los datos de entrega del cliente. Activa en el Dev Dashboard el acceso a datos protegidos (nombre, dirección, teléfono, email) y reprocesa el pedido.", { actor, level: "error" });
    }
    const o = setStatus(order, "solicitado_proveedor", { actor });
    await sendToSupplier(o, "pedido", buildPedidoMessage(o, physicalItems(o.id)), { actor });
    return o;
  }

  // ---------- 5. Seguimiento ----------
  async function handleTracking(order, p, { actor, text }) {
    const t = classifyTracking(p.tracking, p.carrier);
    if (!t) return void createApproval("seguimiento", order, `${order.name}: número de seguimiento sin formato válido`, { text, parsed: p });
    const auto = S("auto_tracking_to_shopify") && t.confidence >= 0.75 && t.carrier;
    if (auto) {
      queue.enqueue("shopify.fulfill", { orderId: order.id, number: t.number, company: t.carrier }, { dedupeKey: `fulfill:${order.id}:${t.number}` });
      audit(db, { actor, action: "seguimiento.detectado", entity: "order", entityId: order.name, details: { carrier: t.carrier, confidence: t.confidence, auto: true } });
    } else {
      createApproval("seguimiento", order, `${order.name}: confirmar seguimiento ${t.number}${t.carrier ? " (" + t.carrier + ")" : ""}`,
        { text, tracking: t, url: trackingUrl(t.carrier, t.number) });
      await alert("info", `${order.name}: seguimiento recibido`, "Revisa y confirma el número en Aprobaciones antes de enviarlo a Shopify.", order.id);
    }
  }

  // Tarea: crear el envío en Shopify. Solo después de éxito se marca "enviado".
  async function fulfillInShopify({ orderId, number, company }) {
    const order = getOrder(orderId);
    if (!order || order.status === "enviado") return;
    const url = trackingUrl(company, number);
    let fulfillmentId = "demo";
    if (!config.demo) {
      if (!config.shopify.configured) throw Object.assign(new Error("Shopify no está configurado: no se puede registrar el envío"), { permanent: true });
      const f = await shopify.createFulfillmentWithTracking(order.shopify_order_id, { number, company, url }, true);
      fulfillmentId = f.id;
    }
    setStatus(getOrder(orderId), "enviado", {
      extra: { tracking_number: number, tracking_company: company, tracking_url: url, shopify_fulfillment_id: fulfillmentId },
    });
    audit(db, { action: "shopify.envio_creado", entity: "order", entityId: order.name, details: { company, demo: config.demo } });
  }

  // ---------- 6. Centro de aprobaciones ----------
  async function decideApproval(approvalId, decision, { note = null, overrides = {} } = {}) {
    const a = db.get("SELECT * FROM approvals WHERE id = ?", approvalId);
    if (!a || a.status !== "pendiente") throw new Error("Aprobación no encontrada o ya resuelta");
    const order = a.order_id ? getOrder(a.order_id) : null;
    const details = JSON.parse(a.details_json);
    db.run("UPDATE approvals SET status = ?, decided_at = datetime('now'), decision_note = ? WHERE id = ?",
      decision === "aprobar" ? "aprobada" : "rechazada", note, approvalId);
    audit(db, { actor: "propietario", action: `aprobacion.${decision}`, entity: "approval", entityId: approvalId, details: { type: a.type, order: order?.name, note } });

    if (decision !== "aprobar") {
      if (a.type === "compra_proveedor" && order) await raiseIncident(order, `Compra rechazada por ti${note ? ": " + note : ""}`, { actor: "propietario", level: "info" });
      return;
    }
    if (a.type === "compra_proveedor" && order) return confirmPurchase(order, "propietario");
    if (a.type === "seguimiento" && order) {
      const number = (overrides.number || details.tracking?.number || "").toUpperCase().replace(/[\s-]/g, "");
      const company = overrides.company || details.tracking?.carrier || null;
      if (!number) throw new Error("Falta el número de seguimiento");
      queue.enqueue("shopify.fulfill", { orderId: order.id, number, company }, { dedupeKey: `fulfill:${order.id}:${number}` });
      return;
    }
    if (a.type === "respuesta_ambigua" && order) {
      // El propietario aclara los datos (disponible, coste total, días) y el flujo continúa.
      const p = {
        ...(details.parsed || {}),
        available: overrides.available ?? details.parsed?.available ?? null,
        price: overrides.totalCost != null ? Number(overrides.totalCost) : details.parsed?.price ?? null,
        priceIsTotal: overrides.totalCost != null ? true : !!details.parsed?.priceIsTotal,
        etaDays: overrides.etaDays != null ? Number(overrides.etaDays) : details.parsed?.etaDays ?? null,
        tracking: overrides.number || details.parsed?.tracking || null,
        carrier: overrides.company || details.parsed?.carrier || null,
        ambiguous: false, problem: false, reasons: [],
      };
      return applyParsed(getOrder(order.id), p, { text: details.text, actor: "propietario" });
    }
  }

  // ---------- 7. Otras acciones del panel ----------
  async function resumeOrder(orderId, to = null) {
    const o = getOrder(orderId);
    if (o.status !== "incidencia") throw new Error("Solo se reanudan pedidos en incidencia");
    if (!to) {
      // Reprocesar desde el principio (p. ej. tras asignar el proveedor en el catálogo).
      db.run("UPDATE orders SET status='nuevo', incident=NULL, updated_at=datetime('now') WHERE id=?", orderId);
      audit(db, { actor: "propietario", action: "pedido.reanudar", entity: "order", entityId: o.name });
      db.run("DELETE FROM jobs WHERE dedupe_key = ?", `order.process:${orderId}`);
      queue.enqueue("order.process", { orderId }, { dedupeKey: `order.process:${orderId}` });
      return;
    }
    setStatus(o, to, { actor: "propietario", extra: { incident: null } });
  }

  async function requestTracking(orderId, actor = "propietario") {
    const o = getOrder(orderId);
    return sendToSupplier(o, "seguimiento", buildSeguimientoMessage(o), { actor });
  }

  function markDelivered(orderId) {
    return setStatus(getOrder(orderId), "entregado", { actor: "propietario" });
  }

  // Webhook orders/cancelled
  async function handleCancelled(shopifyOrderId) {
    const o = db.get("SELECT * FROM orders WHERE shopify_order_id = ?", shopifyOrderId);
    if (!o || o.status === "cancelado") return;
    if (SUPPLIER_HAS_ORDER.includes(o.status)) {
      await raiseIncident(o, "El pedido se ha cancelado en Shopify pero el proveedor ya lo tiene. Avísale para pararlo.", { level: "error" });
    } else setStatus(o, "cancelado", { note: "Cancelado en Shopify" });
  }

  // ---------- 8. Vigilancia periódica ----------
  async function watchdog() {
    const hNoReply = Number(S("hours_no_reply_alert"));
    const hNoTrack = Number(S("hours_no_tracking_alert"));
    const dShip = Number(S("days_shipped_check"));
    const noReply = db.all(
      `SELECT * FROM orders WHERE status = 'pendiente_consulta' AND last_supplier_contact_at IS NOT NULL
       AND last_supplier_contact_at < datetime('now', ?)`, `-${hNoReply} hours`);
    for (const o of noReply) {
      const fresh = queue.enqueue("noop", {}, { dedupeKey: `alert.noreply:${o.id}:${new Date().toISOString().slice(0, 10)}` });
      if (fresh) await alert("aviso", `${o.name}: el proveedor no responde`, `Más de ${hNoReply} h sin respuesta a la consulta.`, o.id);
    }
    const noTrack = db.all(
      `SELECT * FROM orders WHERE status IN ('solicitado_proveedor','confirmado_proveedor','preparando_envio')
       AND updated_at < datetime('now', ?)`, `-${hNoTrack} hours`);
    for (const o of noTrack) {
      const fresh = queue.enqueue("noop", {}, { dedupeKey: `alert.notrack:${o.id}:${new Date().toISOString().slice(0, 10)}` });
      if (fresh) {
        await requestTracking(o.id, "sistema");
        await alert("aviso", `${o.name}: sin seguimiento`, `Más de ${hNoTrack} h sin número de seguimiento. Se ha preparado un mensaje al proveedor.`, o.id);
      }
    }
    const longShipped = db.all(`SELECT * FROM orders WHERE status = 'enviado' AND updated_at < datetime('now', ?)`, `-${dShip} days`);
    for (const o of longShipped) {
      const fresh = queue.enqueue("noop", {}, { dedupeKey: `alert.longship:${o.id}` });
      if (fresh) await alert("aviso", `${o.name}: revisa la entrega`, `Lleva más de ${dShip} días enviado. Comprueba el seguimiento y márcalo como entregado.`, o.id);
    }
  }

  // RGPD: borra datos personales de pedidos cerrados pasado el plazo de conservación.
  function purgePii() {
    const r = db.run(
      `UPDATE orders SET customer_name=NULL, customer_email=NULL, ship_name=NULL, ship_address1=NULL, ship_address2=NULL,
         ship_zip=NULL, ship_city=NULL, ship_province=NULL, ship_phone=NULL, pii_purged_at=datetime('now')
       WHERE pii_purged_at IS NULL AND status IN ('entregado','cancelado') AND updated_at < datetime('now', ?)`,
      `-${config.piiRetentionDays} days`
    );
    db.run(`UPDATE messages SET body='[eliminado por conservación de datos]' WHERE kind='pedido' AND order_id IN (SELECT id FROM orders WHERE pii_purged_at IS NOT NULL)`);
    if (r.changes) audit(db, { action: "rgpd.purga", result: "ok", details: { orders: r.changes } });
    return r.changes;
  }

  // Registrar manejadores de la cola.
  queue.register("order.process", ({ orderId }) => processOrder(orderId));
  queue.register("message.send", ({ messageId }) => sendQueuedMessage(messageId));
  queue.register("shopify.fulfill", (p) => fulfillInShopify(p));
  queue.register("noop", async () => {});

  return {
    STATES, ingestPaidOrder, processOrder, receiveSupplierMessage, markManualSent, messageLink,
    decideApproval, resumeOrder, requestTracking, markDelivered, handleCancelled, watchdog, purgePii,
    getOrder, getItems,
  };
}

const fmt = (v) => (v == null ? "importe sin confirmar" : `${Number(v).toFixed(2).replace(".", ",")} €`);
