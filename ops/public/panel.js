(() => {
  "use strict";
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const eur = (v) => (v == null ? "—" : Number(v).toLocaleString("es-ES", { style: "currency", currency: "EUR" }));
  const when = (s) => (s ? new Date(s.includes("T") ? s : s.replace(" ", "T") + "Z").toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "");
  let STATES = {};
  let summary = null;
  let tab = "resumen";
  let orderFilter = "";

  async function api(path, opts = {}) {
    const res = await fetch("/api" + path, {
      method: opts.method || "GET",
      headers: { "Content-Type": "application/json", "x-requested-with": "ops-panel" },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
    });
    if (res.status === 401 && path !== "/login") { showLogin(); throw new Error("Sesión caducada"); }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "Error " + res.status);
    return j;
  }
  function toast(t) {
    const el = $("#toast"); el.textContent = t; el.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 3200);
  }
  const act = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast("⚠️ " + e.message); } };

  const statusBadge = (s) => {
    const cls = { incidencia: "err", pendiente_autorizacion: "warn", enviado: "ok", entregado: "ok", cancelado: "", nuevo: "info" }[s] ?? "info";
    return `<span class="badge ${cls}">${esc(STATES[s] || s)}</span>`;
  };

  // ---------- Login ----------
  function showLogin() { $("#app").hidden = true; $("#login").hidden = false; }
  $("#login-form").addEventListener("submit", act(async (e) => {
    e.preventDefault();
    $("#login-err").textContent = "";
    try {
      await api("/login", { method: "POST", body: { password: e.target.password.value } });
      e.target.reset(); start();
    } catch (err) { $("#login-err").textContent = err.message; }
  }));

  // ---------- Cabecera ----------
  async function refreshHeader() {
    summary = await api("/summary");
    STATES = summary.states;
    $("#demo-badge").hidden = !summary.demo;
    $("#paused-banner").hidden = !summary.paused;
    $("#pause-btn").textContent = summary.paused ? "▶ Reanudar" : "⏸ Pausar";
    $("#pause-btn").className = "btn small " + (summary.paused ? "ok" : "danger");
    $("#alerts-count").textContent = summary.unreadAlerts;
    $("#ap-count").textContent = summary.pendingApprovals || "";
  }
  $("#pause-btn").addEventListener("click", act(async () => {
    const pause = !summary.paused;
    if (pause && !confirm("¿Pausar todas las automatizaciones? No se enviarán mensajes ni se actualizará Shopify.")) return;
    await api("/pause", { method: "POST", body: { paused: pause } });
    await refreshHeader(); toast(pause ? "Automatizaciones en pausa" : "Automatizaciones reanudadas");
  }));
  $("#alerts-btn").addEventListener("click", act(async () => {
    const alerts = await api("/alerts");
    openDrawer(`<h2>Alertas</h2><div class="list">${alerts.map((a) => `
      <div class="card"><div class="row between"><b>${esc(a.title)}</b><span class="badge ${a.level === "error" ? "err" : a.level === "aviso" ? "warn" : "info"}">${esc(a.level)}</span></div>
      <div class="mute small">${when(a.created_at)}</div>${a.body ? `<div>${esc(a.body)}</div>` : ""}
      ${a.order_id ? `<button class="btn small" data-open-order="${a.order_id}">Ver pedido</button>` : ""}</div>`).join("") || '<p class="mute">Sin alertas.</p>'}</div>`);
    await api("/alerts/read", { method: "POST" });
    refreshHeader();
  }));

  // ---------- Pestañas ----------
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (!b) return;
    tab = b.dataset.tab;
    $$("#tabs button").forEach((x) => x.classList.toggle("on", x === b));
    render();
  });
  const views = {};
  async function render() {
    const v = $("#view");
    v.innerHTML = '<p class="mute">Cargando…</p>';
    try { await refreshHeader(); v.innerHTML = await views[tab](); } catch (e) { v.innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }

  views.setup = async () => {
    const d = await api("/diagnostics");
    $("#setup-count").textContent = d.checks.filter((c) => c.ok === false).length || "";
    const icon = (ok) => (ok === true ? '<span class="badge ok">✔ listo</span>' : ok === false ? '<span class="badge err">✖ falta</span>' : ok === "demo" ? '<span class="badge warn">simulado</span>' : '<span class="badge">opcional</span>');
    return `<section class="card ${d.ready ? "" : "missing"}"><h2>${d.ready ? "✅ Todo listo para funcionar" : "Puesta en marcha"}</h2>
        <p class="mute small">Comprobación real de cada conexión (${when(d.at)}). Los puntos ✖ impiden el funcionamiento; los opcionales mejoran la automatización.</p></section>
      <div class="list">${d.checks.map((c) => `
        <div class="card"><div class="row between"><b>${esc(c.name)}</b>${icon(c.ok)}</div>
        <div class="small">${esc(c.detail)}</div>${c.ok === false && c.fix ? `<div class="small missing">${esc(c.fix)}</div>` : ""}</div>`).join("")}</div>
      <section class="card"><h3>Acciones</h3><div class="row">
        <button class="btn" data-setup="webhooks">Registrar webhooks</button>
        <button class="btn" data-setup="sync-catalog">Sincronizar catálogo</button>
        <button class="btn" data-setup="test-alert">Enviar alerta de prueba</button>
        <button class="btn ghost" data-setup="refresh">↻ Volver a comprobar</button>
      </div>${d.lastCatalogSync ? `<p class="small mute">Última sincronización: ${when(d.lastCatalogSync.at)} · ${d.lastCatalogSync.total} variantes</p>` : ""}</section>`;
  };

  views.resumen = async () => {
    const s = summary, t = s.today, m = s.month, st = s.byStatus;
    const k = (l, v, sub = "") => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div>${sub ? `<div class="mute small">${sub}</div>` : ""}</div>`;
    const pendingSupplier = (st.pendiente_consulta || 0) + (st.solicitado_proveedor || 0) + (st.confirmado_proveedor || 0) + (st.preparando_envio || 0);
    const rep = await api("/reports/today");
    return `
      <section><h2>Hoy</h2><div class="grid">
        ${k("Ventas hoy", eur(t.revenueGross), `${t.orders} pedido(s)`)}
        ${k("Beneficio estimado hoy", eur(t.profitEstimate), t.profitEstimate == null ? "faltan costes" : "sin IVA, comisiones y publicidad")}
        ${k("Publicidad hoy", eur(t.adSpend))}
        ${k("Ventas del mes", eur(m.revenueGross), `${m.orders} pedido(s)`)}
        ${k("Beneficio est. mes", eur(m.profitEstimate), m.roas ? `ROAS ${m.roas}` : "")}
      </div></section>
      <section><h2>Operaciones</h2><div class="grid">
        ${k("Aprobaciones pendientes", s.pendingApprovals)}
        ${k("Con el proveedor", pendingSupplier)}
        ${k("Enviados", st.enviado || 0)}
        ${k("Incidencias", st.incidencia || 0)}
        ${k("Tareas fallidas", s.failedJobs)}
        ${k("Campañas activas", "—", "publicidad sin conectar")}
      </div></section>
      <section class="card"><h3>Prioridades del director</h3>
        ${rep.priorities.length ? `<ol>${rep.priorities.map((p) => `<li>${esc(p)}</li>`).join("")}</ol>` : '<p class="mute">Todo en orden.</p>'}
      </section>
      <section class="card"><h3>Conexiones</h3><dl class="kv">
        ${Object.entries(s.integrations).map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join("")}
      </dl></section>
      ${s.month.missing.length ? `<section class="card missing"><h3>Datos que faltan para calcular el beneficio real</h3><ul>${s.month.missing.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></section>` : ""}
      ${s.demo ? `<section class="card"><h3>Modo demostración</h3><p class="mute">Crea un pedido ficticio para ver el flujo completo.</p><button class="btn primary" data-demo-order>➕ Simular pedido pagado</button></section>` : ""}`;
  };

  const GROUPS = [
    ["", "Todos"], ["nuevo", "Nuevos"], ["pendiente_consulta", "Pendientes de proveedor"], ["pendiente_autorizacion", "Pendientes de aprobación"],
    ["solicitado_proveedor", "Solicitados"], ["confirmado_proveedor", "Confirmados"], ["preparando_envio", "Preparando"],
    ["enviado", "Enviados"], ["entregado", "Entregados"], ["incidencia", "Incidencias"], ["cancelado", "Cancelados"],
  ];
  views.pedidos = async () => {
    const list = await api("/orders" + (orderFilter ? "?status=" + orderFilter : ""));
    return `<div class="chips" id="order-chips">${GROUPS.map(([k, l]) => `<button data-filter="${k}" class="${k === orderFilter ? "on" : ""}">${l}${k && summary.byStatus[k] ? " · " + summary.byStatus[k] : ""}</button>`).join("")}</div>
      <div class="list">${list.map((o) => `
        <div class="item" data-open-order="${o.id}">
          <div class="row between"><b>${esc(o.name)}</b>${statusBadge(o.status)}</div>
          <div class="small">${o.items.map((i) => `${esc(i.title)}${i.variant_title ? " · " + esc(i.variant_title) : ""} ×${i.quantity}`).join("<br>")}</div>
          <div class="row between small mute"><span>${when(o.created_at)}</span><span>Venta ${eur(o.total_price)} · Benef. ${eur(o.economics.profit)}</span></div>
          ${o.incident ? `<div class="small err">${esc(o.incident)}</div>` : ""}
        </div>`).join("") || '<p class="mute">No hay pedidos en este estado.</p>'}</div>`;
  };

  async function openOrder(id) {
    const o = await api("/orders/" + id);
    const e = o.economics;
    const msgs = o.messages.map((m) => `
      <div class="msg ${m.direction}">
        <div class="row between small mute"><span>${m.direction === "out" ? "Tú → proveedor" : "Proveedor"} · ${esc(m.kind)} · ${esc(m.channel === "whatsapp_api" ? "API" : "manual")}</span><span>${esc(m.status)} · ${when(m.sent_at || m.created_at)}</span></div>
        <div>${esc(m.body)}</div>
        ${m.link ? `<div class="row"><a class="btn wa small" href="${esc(m.link)}" target="_blank" rel="noopener">Enviar por WhatsApp</a><button class="btn small" data-sent="${m.id}">✓ Ya lo he enviado</button></div>` : ""}
        ${m.status === "fallido" ? `<button class="btn small" data-retry="${m.id}">Reintentar envío</button>` : ""}
      </div>`).join("");
    openDrawer(`
      <div class="row between"><h2>${esc(o.name)}</h2>${statusBadge(o.status)}</div>
      ${o.incident ? `<div class="card missing"><b>Incidencia:</b> ${esc(o.incident)}</div>` : ""}
      <div class="card"><h3>Productos</h3>${o.items.map((i) => `<div>${esc(i.title)}${i.variant_title ? " · " + esc(i.variant_title) : ""} ×${i.quantity} — ${eur(i.unit_price)}${i.supplier_ref ? ` <span class="mute small">(ref. ${esc(i.supplier_ref)})</span>` : ""}</div>`).join("")}</div>
      <div class="card"><h3>Rentabilidad estimada</h3><dl class="kv">
        <dt>Venta (con IVA)</dt><dd>${eur(e.revenueGross)}</dd><dt>Venta sin IVA</dt><dd>${eur(e.revenueNet)}</dd>
        <dt>Coste proveedor</dt><dd>${eur(e.supplierCost)}</dd><dt>Comisión de pago</dt><dd>${eur(e.paymentFees)}</dd>
        <dt>Publicidad atribuida</dt><dd>${eur(e.adsAllocated)}</dd><dt><b>Beneficio</b></dt><dd><b>${eur(e.profit)}</b>${e.marginPercent != null ? ` (${e.marginPercent}%)` : ""}</dd>
      </dl>${e.missing.length ? `<p class="small missing">Falta: ${e.missing.map(esc).join(", ")}</p>` : ""}</div>
      <div class="card"><h3>Envío</h3>${o.pii_purged_at ? '<p class="mute">Datos personales eliminados por el plazo de conservación.</p>' : `<div>${esc(o.ship_name)}<br>${esc(o.ship_address1)} ${esc(o.ship_address2)}<br>${esc(o.ship_zip)} ${esc(o.ship_city)} (${esc(o.ship_province)})</div>`}
        ${o.tracking_number ? `<p>Seguimiento: <a href="${esc(o.tracking_url)}" target="_blank" rel="noopener">${esc(o.tracking_number)}</a> · ${esc(o.tracking_company)}</p>` : ""}
        ${o.supplier_eta_days != null ? `<p class="mute small">Plazo indicado por el proveedor: ${o.supplier_eta_days} días</p>` : ""}</div>
      <div class="card"><h3>Conversación con el proveedor</h3><div class="list">${msgs || '<p class="mute">Sin mensajes.</p>'}</div>
        <form class="list" id="reply-form" data-order="${o.id}">
          <label>Pega aquí la respuesta del proveedor (modo manual)<textarea name="text" placeholder="Ej.: Sí hay, 11,50 € con envío, 3-5 días"></textarea></label>
          <button class="btn primary" type="submit">Interpretar respuesta</button>
        </form></div>
      <div class="row">
        ${o.status === "incidencia" ? `<button class="btn" data-resume="${o.id}">↻ Reprocesar pedido</button>` : ""}
        ${["solicitado_proveedor", "confirmado_proveedor", "preparando_envio"].includes(o.status) ? `<button class="btn" data-ask-tracking="${o.id}">Pedir seguimiento</button>` : ""}
        ${o.status === "enviado" ? `<button class="btn ok" data-delivered="${o.id}">Marcar entregado</button>` : ""}
      </div>
      <details class="card"><summary>Historial (${o.history.length})</summary><div class="list small">${o.history.map((h) => `<div><span class="mute">${when(h.at)}</span> · ${esc(h.actor)} · ${esc(h.action)} · ${esc(h.result)} ${h.details_json ? `<span class="mute">${esc(h.details_json)}</span>` : ""}</div>`).join("")}</div></details>`);
  }

  views.aprobaciones = async () => {
    const list = await api("/approvals");
    if (!list.length) return '<div class="card"><h2>Centro de aprobaciones</h2><p class="mute">No hay nada pendiente. 👌</p></div>';
    return `<h2>Centro de aprobaciones</h2><div class="list">${list.map((a) => {
      const d = JSON.parse(a.details_json);
      let body = "";
      if (a.type === "compra_proveedor") {
        const e = d.economics || {};
        body = `<dl class="kv"><dt>Coste</dt><dd>${eur(d.cost?.total)} <span class="mute small">(${esc(d.cost?.source)})</span></dd>
          <dt>Venta sin IVA</dt><dd>${eur(e.revenueNet)}</dd><dt>Beneficio est.</dt><dd>${eur(e.profit)} ${e.marginPercent != null ? `(${e.marginPercent}%)` : ""}</dd>
          <dt>Plazo</dt><dd>${d.etaDays != null ? d.etaDays + " días" : "sin confirmar"}</dd></dl>
          ${d.lowMargin ? '<p class="err small">⚠️ Margen por debajo de tu mínimo.</p>' : ""}
          ${d.cost && !d.cost.confirmed ? '<p class="small missing">El coste no está totalmente confirmado por el proveedor.</p>' : ""}
          <p class="small mute">Al aprobar se enviará al proveedor el pedido con la dirección de entrega.</p>`;
      } else if (a.type === "seguimiento") {
        body = `${d.text ? `<div class="msg in">${esc(d.text)}</div>` : ""}
          <div class="cat-row"><label>Nº seguimiento<input name="number" value="${esc(d.tracking?.number || "")}"></label>
          <label>Transportista<input name="company" value="${esc(d.tracking?.carrier || "")}"></label></div>
          ${d.url ? `<a class="small" href="${esc(d.url)}" target="_blank" rel="noopener">Comprobar en la web del transportista</a>` : ""}
          <p class="small mute">Al aprobar se registra el envío en Shopify y Shopify avisa al cliente.</p>`;
      } else {
        body = `<div class="msg in">${esc(d.text || "")}</div>${d.why ? `<p class="small missing">${esc(d.why)}</p>` : ""}
          ${a.order_id ? `<div class="cat-row"><label>¿Disponible?<select name="available"><option value="">—</option><option value="si">Sí</option><option value="no">No</option></select></label>
          <label>Coste total (€)<input name="totalCost" inputmode="decimal"></label><label>Días de envío<input name="etaDays" inputmode="numeric"></label>
          <label>Nº seguimiento<input name="number"></label><label>Transportista<input name="company"></label></div>
          <p class="small mute">Rellena lo que corresponda y aprueba para continuar el pedido.</p>` : '<p class="small mute">No se pudo asociar a un pedido. Ábrelo en WhatsApp y pega la respuesta en el pedido correcto.</p>'}`;
      }
      return `<form class="card list" data-approval="${a.id}">
        <div class="row between"><b>${esc(a.title)}</b>${a.order_id ? `<button type="button" class="btn small ghost" data-open-order="${a.order_id}">Ver pedido</button>` : ""}</div>
        <div class="mute small">${when(a.created_at)} · ${esc(a.type.replace("_", " "))}</div>${body}
        <label>Nota (opcional)<input name="note"></label>
        <div class="row"><button class="btn ok" name="d" value="aprobar">Aprobar</button><button class="btn danger" name="d" value="rechazar">Rechazar</button></div>
      </form>`;
    }).join("")}</div>`;
  };

  views.catalogo = async () => {
    const [cat, sups] = await Promise.all([api("/catalog"), api("/suppliers")]);
    const opts = (sel) => `<option value="">—</option>` + sups.map((s) => `<option value="${s.id}" ${s.id === sel ? "selected" : ""}>${esc(s.name)}</option>`).join("");
    return `
      <section class="card"><h2>Proveedores</h2>
        ${sups.map((s) => `<div class="row between"><span><b>${esc(s.name)}</b> · +${esc(s.whatsapp)}</span>${s.consent_at ? `<span class="badge ok">consentimiento ${when(s.consent_at)}</span>` : '<span class="badge warn">sin consentimiento registrado</span>'}</div>`).join("") || '<p class="mute">Añade tu proveedor.</p>'}
        <form id="supplier-form" class="cat-row">
          <label>Nombre<input name="name" required></label>
          <label>WhatsApp (con prefijo, ej. 34600111222)<input name="whatsapp" inputmode="tel" required></label>
          <label class="row"><input type="checkbox" name="consent"> El proveedor acepta recibir pedidos por este sistema</label>
          <button class="btn primary">Guardar proveedor</button>
        </form>
        <p class="small mute">Sin consentimiento registrado los mensajes se preparan para que tú los envíes (modo manual), aunque la API esté conectada.</p>
      </section>
      <section class="card"><h2>Catálogo del proveedor</h2>
        <p class="small mute">Relaciona cada variante de Shopify con la referencia y el coste de tu proveedor. Sin coste no hay cálculo de beneficio; sin proveedor el pedido queda en incidencia.</p>
        ${sups.length && cat.some((c) => !c.supplier_id) ? `<div class="row"><select id="assign-all-supplier">${opts(null)}</select><button class="btn small" data-assign-all="1">Asignar proveedor a todas las variantes sin proveedor</button></div>` : ""}
        <div class="list">${cat.map((c) => `
          <form class="card cat-row" data-cat="${c.id}">
            <div><b>${esc(c.title)}</b><div class="mute small">${esc(c.variant_title || "")} ${c.sku ? "· " + esc(c.sku) : ""}</div></div>
            <label>Proveedor<select name="supplier_id">${opts(c.supplier_id)}</select></label>
            <label>Ref. proveedor<input name="supplier_ref" value="${esc(c.supplier_ref || "")}"></label>
            <label>Coste unidad €<input name="unit_cost" inputmode="decimal" value="${c.unit_cost ?? ""}"></label>
            <label>Envío €<input name="shipping_cost" inputmode="decimal" value="${c.shipping_cost ?? ""}"></label>
            <label class="row"><input type="checkbox" name="auto_order" ${c.auto_order ? "checked" : ""}> Compra automática</label>
            <label>Máx. por pedido €<input name="auto_max_amount" inputmode="decimal" value="${c.auto_max_amount ?? ""}"></label>
            <button class="btn small">Guardar</button>
          </form>`).join("") || '<p class="mute">Vacío. Ejecuta <code>npm run shopify:sync-products</code> cuando Shopify esté conectado.</p>'}</div>
      </section>`;
  };

  views.agentes = async () => {
    const [agents, jobs] = await Promise.all([api("/agents"), api("/jobs")]);
    return `<h2>Agentes de IA</h2><div class="list">${agents.map((a) => `
      <div class="card"><div class="row between"><b>${esc(a.name)}</b><span class="badge ${a.status.startsWith("activo") ? "ok" : "warn"}">${esc(a.status)}</span></div>
      <div class="small">${esc(a.detail)}</div>${a.lastRun ? `<div class="mute small">Última actividad: ${when(a.lastRun)}</div>` : ""}</div>`).join("")}</div>
      <section class="card"><h3>Tareas recientes</h3><div class="table-wrap"><table><tr><th>Tarea</th><th>Estado</th><th>Intentos</th><th>Error</th></tr>
      ${jobs.map((j) => `<tr><td>${esc(j.type)}</td><td>${esc(j.status)}</td><td>${j.attempts}</td><td class="small">${esc(j.last_error || "")}</td></tr>`).join("")}</table></div></section>`;
  };

  views.registro = async () => {
    const log = await api("/audit");
    return `<h2>Registro de acciones</h2><div class="table-wrap"><table><tr><th>Fecha</th><th>Quién</th><th>Acción</th><th>Sobre</th><th>Resultado</th></tr>
      ${log.map((l) => `<tr><td>${when(l.at)}</td><td>${esc(l.actor)}</td><td>${esc(l.action)}<div class="mute small">${esc(l.details_json || "")}</div></td><td>${esc(l.entity_id || "")}</td><td><span class="badge ${l.result === "ok" ? "ok" : l.result === "error" ? "err" : "warn"}">${esc(l.result)}</span></td></tr>`).join("")}</table></div>`;
  };

  views.ajustes = async () => {
    const [s, reps] = await Promise.all([api("/settings"), api("/reports")]);
    const chk = (k, l, help) => `<label class="row"><input type="checkbox" name="${k}" ${s[k] ? "checked" : ""}> <span><b>${l}</b><br><span class="mute small">${help}</span></span></label>`;
    const num = (k, l) => `<label>${l}<input name="${k}" inputmode="decimal" value="${esc(s[k])}"></label>`;
    return `
      <form class="card list" id="settings-form"><h2>Reglas y límites</h2>
        ${chk("auto_purchase_enabled", "Compras automáticas al proveedor", "Solo para productos marcados en el catálogo, con coste confirmado, por debajo del máximo y con margen suficiente. Desactivado = todo pasa por tu aprobación.")}
        ${chk("auto_tracking_to_shopify", "Subir seguimiento a Shopify sin aprobación", "Solo si el número tiene un formato fiable y transportista identificado.")}
        <div class="cat-row">${num("min_margin_percent", "Margen mínimo %")}${num("vat_percent", "IVA incluido en tus precios %")}${num("hours_no_reply_alert", "Avisar si el proveedor no responde (h)")}${num("hours_no_tracking_alert", "Avisar sin seguimiento (h)")}${num("days_shipped_check", "Revisar entrega tras (días)")}</div>
        <label>Productos de servicio que no se piden al proveedor (expresión)<input name="service_item_pattern" value="${esc(s.service_item_pattern)}"></label>
        <button class="btn primary">Guardar ajustes</button>
      </form>
      <form class="card list" id="spend-form"><h2>Gasto publicitario</h2>
        <p class="small mute">Hasta conectar Meta/Google/TikTok Ads, apunta aquí el gasto diario para calcular beneficio, CAC y ROAS.</p>
        <div class="cat-row"><label>Día<input type="date" name="day" required></label><label>Plataforma<select name="platform"><option value="meta">Meta</option><option value="google">Google</option><option value="tiktok">TikTok</option></select></label><label>Importe €<input name="amount" inputmode="decimal" required></label><button class="btn">Guardar gasto</button></div>
      </form>
      <section class="card"><div class="row between"><h2>Informes diarios</h2><button class="btn small" data-run-report>Generar informe de ayer</button></div>
        ${reps.map((r) => { const f = r.data.finance; return `<details><summary>${esc(r.period)} · ${f.orders} pedidos · ${eur(f.revenueGross)} · benef. ${eur(f.profitEstimate)}</summary><ul class="small">${r.data.priorities.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></details>`; }).join("") || '<p class="mute">Se generan solos cada día a las 08:00.</p>'}
      </section>
      <button class="btn ghost" id="logout">Cerrar sesión</button>`;
  };

  // ---------- Cajón de detalle ----------
  function openDrawer(html) { $("#drawer-body").innerHTML = html; $("#drawer").hidden = false; }
  function closeDrawer() { $("#drawer").hidden = true; }
  $("#drawer-close").addEventListener("click", closeDrawer);
  $("#drawer").addEventListener("click", (e) => { if (e.target.id === "drawer") closeDrawer(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

  // ---------- Acciones (delegadas) ----------
  document.addEventListener("click", act(async (e) => {
    const t = e.target.closest("[data-setup],[data-assign-all],[data-open-order],[data-filter],[data-sent],[data-retry],[data-resume],[data-ask-tracking],[data-delivered],[data-demo-order],[data-run-report],#logout");
    if (!t) return;
    if (t.dataset.setup) {
      if (t.dataset.setup !== "refresh") {
        t.disabled = true;
        const r = await api(`/setup/${t.dataset.setup}`, { method: "POST" }).finally(() => (t.disabled = false));
        toast(t.dataset.setup === "webhooks" ? (r.created.length ? "Registrados: " + r.created.join(", ") : "Ya estaban registrados")
          : t.dataset.setup === "sync-catalog" ? `Catálogo: ${r.added} nuevas, ${r.updated} actualizadas`
          : r.ntfy ? "Alerta enviada al móvil" : "Alerta creada (configura ntfy para recibirla en el móvil)");
      }
      return render();
    }
    if (t.dataset.assignAll) {
      const sel = $("#assign-all-supplier");
      if (!sel.value) return toast("Elige un proveedor");
      const r = await api("/catalog/assign-all", { method: "POST", body: { supplier_id: Number(sel.value) } });
      toast(`Asignado a ${r.updated} variante(s)`);
      return render();
    }
    if (t.dataset.openOrder) return openOrder(t.dataset.openOrder);
    if (t.dataset.filter !== undefined) { orderFilter = t.dataset.filter; return render(); }
    if (t.dataset.sent) { await api(`/messages/${t.dataset.sent}/sent`, { method: "POST" }); toast("Marcado como enviado"); return reopen(); }
    if (t.dataset.retry) { await api(`/messages/${t.dataset.retry}/retry`, { method: "POST" }); toast("Reintento en cola"); return reopen(); }
    if (t.dataset.resume) { await api(`/orders/${t.dataset.resume}/resume`, { method: "POST", body: {} }); toast("Pedido reprocesándose"); return reopen(); }
    if (t.dataset.askTracking) { await api(`/orders/${t.dataset.askTracking}/request-tracking`, { method: "POST" }); toast("Mensaje preparado"); return reopen(); }
    if (t.dataset.delivered) { await api(`/orders/${t.dataset.delivered}/delivered`, { method: "POST" }); toast("Marcado como entregado"); return reopen(); }
    if (t.hasAttribute("data-demo-order")) { await api("/demo/order", { method: "POST" }); toast("Pedido de prueba creado"); tab = "pedidos"; $$("#tabs button").forEach((x) => x.classList.toggle("on", x.dataset.tab === "pedidos")); return render(); }
    if (t.hasAttribute("data-run-report")) { await api("/reports/run", { method: "POST", body: {} }); toast("Informe generado"); return render(); }
    if (t.id === "logout") { await api("/logout", { method: "POST" }); return showLogin(); }
  }));
  let lastOrder = null;
  const _open = openOrder;
  openOrder = async (id) => { lastOrder = id; return _open(id); };
  async function reopen() { if (lastOrder && !$("#drawer").hidden) await openOrder(lastOrder); render(); }

  document.addEventListener("submit", act(async (e) => {
    const f = e.target;
    if (f.id === "login-form") return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(f));
    if (f.id === "reply-form") {
      const r = await api(`/orders/${f.dataset.order}/reply`, { method: "POST", body: { text: data.text } });
      toast(r.parsed?.ambiguous ? "Respuesta dudosa: revísala en Aprobaciones" : "Respuesta interpretada");
      return reopen();
    }
    if (f.dataset.approval) {
      const decision = e.submitter?.value || "aprobar";
      const overrides = {};
      if (data.number) overrides.number = data.number;
      if (data.company) overrides.company = data.company;
      if (data.available) overrides.available = data.available === "si";
      if (data.totalCost) overrides.totalCost = Number(String(data.totalCost).replace(",", "."));
      if (data.etaDays) overrides.etaDays = Number(data.etaDays);
      if (decision === "rechazar" && !confirm("¿Rechazar? El pedido quedará en incidencia.")) return;
      await api(`/approvals/${f.dataset.approval}`, { method: "POST", body: { decision, note: data.note, overrides } });
      toast(decision === "aprobar" ? "Aprobado" : "Rechazado");
      return render();
    }
    if (f.dataset.cat) {
      await api("/catalog", { method: "POST", body: { id: Number(f.dataset.cat), ...data, supplier_id: data.supplier_id ? Number(data.supplier_id) : null, auto_order: !!data.auto_order } });
      return toast("Guardado");
    }
    if (f.id === "supplier-form") {
      await api("/suppliers", { method: "POST", body: { ...data, consent: !!data.consent } });
      toast("Proveedor guardado"); return render();
    }
    if (f.id === "settings-form") {
      const body = { ...data, auto_purchase_enabled: !!data.auto_purchase_enabled, auto_tracking_to_shopify: !!data.auto_tracking_to_shopify };
      if (body.auto_purchase_enabled && !confirm("Las compras automáticas comprometen dinero sin preguntarte (dentro de los límites del catálogo). ¿Activar?")) return;
      await api("/settings", { method: "POST", body });
      toast("Ajustes guardados"); return render();
    }
    if (f.id === "spend-form") {
      await api("/ad-spend", { method: "POST", body: { ...data, amount: Number(String(data.amount).replace(",", ".")) } });
      toast("Gasto guardado"); f.reset();
    }
  }));

  async function start() {
    $("#login").hidden = true; $("#app").hidden = false;
    try {
      const d = await api("/diagnostics");
      if (!d.ready) { tab = "setup"; $$("#tabs button").forEach((x) => x.classList.toggle("on", x.dataset.tab === "setup")); }
      $("#setup-count").textContent = d.checks.filter((c) => c.ok === false).length || "";
    } catch {}
    await render();
    clearInterval(start.t);
    start.t = setInterval(() => { if ($("#drawer").hidden && !document.hidden && tab !== "ajustes" && tab !== "catalogo") render(); }, 60000);
  }
  api("/summary").then(start).catch(() => showLogin());
})();
