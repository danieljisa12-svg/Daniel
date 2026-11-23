// WhatsApp Business Platform (Cloud API oficial de Meta).
// - Dentro de las 24 h desde el último mensaje del proveedor: texto libre.
// - Fuera de esa ventana: Meta exige una plantilla aprobada (WHATSAPP_TEMPLATE_CONSULTA).
export function createWhatsAppClient(config, fetchImpl = globalThis.fetch) {
  const w = config.whatsapp;
  const url = () => `https://graph.facebook.com/${w.graphVersion}/${w.phoneNumberId}/messages`;

  async function post(body) {
    if (!w.apiConfigured) throw new Error("WhatsApp Cloud API no configurada");
    const res = await fetchImpl(url(), {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${w.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = j?.error?.message || `HTTP ${res.status}`;
      const err = new Error(`WhatsApp: ${msg}`);
      err.code = j?.error?.code;
      // 131047 = fuera de la ventana de 24 h → hay que usar plantilla
      err.needsTemplate = j?.error?.code === 131047;
      throw err;
    }
    return j.messages?.[0]?.id;
  }

  return {
    sendText: (to, text) => post({ to: digits(to), type: "text", text: { body: text, preview_url: false } }),

    // Plantilla "consulta_pedido_proveedor" (categoría Utilidad) con 2 parámetros:
    // {{1}} referencia del pedido, {{2}} resumen de productos en una línea. Ver docs/whatsapp.md.
    sendConsultaTemplate: (to, orderName, summary) =>
      post({
        to: digits(to),
        type: "template",
        template: {
          name: w.templateConsulta,
          language: { code: w.templateLang },
          components: [{ type: "body", parameters: [{ type: "text", text: orderName }, { type: "text", text: oneLine(summary || orderName) }] }],
        },
      }),
  };
}

// Los parámetros de plantilla no admiten saltos de línea ni tabulaciones.
const oneLine = (t) => String(t).replace(/[\n\t]+/g, " · ").replace(/ {4,}/g, " ").slice(0, 900);
const digits = (p) => String(p).replace(/\D/g, "");

// Extrae mensajes entrantes y estados del webhook de WhatsApp.
export function parseWhatsAppWebhook(body) {
  const out = { messages: [], statuses: [] };
  for (const entry of body?.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      for (const m of v.messages || []) {
        out.messages.push({
          id: m.id,
          from: m.from,
          timestamp: Number(m.timestamp) * 1000 || Date.now(),
          type: m.type,
          text: m.type === "text" ? m.text?.body || "" : m.type === "button" ? m.button?.text || "" : "",
          contextId: m.context?.id || null, // si el proveedor responde citando un mensaje nuestro
        });
      }
      for (const s of v.statuses || []) out.statuses.push({ id: s.id, status: s.status, errors: s.errors || null });
    }
  }
  return out;
}
