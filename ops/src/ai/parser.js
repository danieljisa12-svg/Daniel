// Interpreta las respuestas del proveedor.
// 1) Reglas deterministas (siempre activas, gratis, en español de España).
// 2) Claude (opcional) para mensajes difíciles. Su resultado se contrasta con el texto original:
//    un precio o un número de seguimiento que no aparezca literalmente en el mensaje se descarta.
// Si hay dudas, el resultado se marca como ambiguo y va al centro de aprobaciones.
import { findTrackingCandidates, detectCarrierName } from "../tracking.js";

const NEG = /\b(no (lo )?(hay|tengo|tenemos|queda|quedan|me queda)|agotad[oa]s?|sin stock|sin existencias|no disponible|no est[aá] disponible|rotura de stock|descatalogad[oa])\b/i;
const POS = /\b(disponible|s[ií] (hay|tengo|tenemos|queda)|hay stock|en stock|tengo stock|lo tengo|los tengo|las tengo|sin problema|perfecto|ok|vale|claro|de acuerdo)\b/i;
const STRONG_POS = /\b(disponible|s[ií] (hay|tengo|tenemos|queda)|hay stock|en stock|tengo stock|lo tengo|los tengo|las tengo)\b/i;
const CONFIRM = /\b(pedido (hecho|confirmado|realizado|registrado|apuntado|recibido)|confirmado|apuntado|anotado|recibido|marchando|lo (preparo|mando|env[ií]o|enviamos)|te lo (mando|env[ií]o))\b/i;
const PREPARING = /\b(preparando|en preparaci[oó]n|lo estoy preparando|sale (ma[ñn]ana|hoy|el lunes|el martes|el mi[eé]rcoles|el jueves|el viernes))\b/i;
const SHIPPED = /\b(enviado|ya (ha )?salido|ya sali[oó]|ha salido|despachado|entregado a (la )?(agencia|transportista)|seguimiento|tracking|localizador)\b/i;
const PROBLEM = /\b(problema|incidencia|retraso|roto|rota|da[ñn]ado|devuelto|perdido|no llega|aduana)\b/i;

const parseNum = (s) => Number(String(s).replace(/\./g, "").replace(",", ".")) || Number(String(s).replace(",", "."));

export function extractPrices(text) {
  const out = [];
  const re = /(?:(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:€|eur(?:os)?\b))|(?:€\s*(\d{1,4}(?:[.,]\d{1,2})?))|(?:precio[^0-9\n]{0,15}(\d{1,4}(?:[.,]\d{1,2})?))/gi;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[1] || m[2] || m[3];
    const v = Number(raw.replace(",", "."));
    if (!(Number.isFinite(v) && v > 0 && v < 10000)) continue;
    const before = text.slice(Math.max(0, m.index - 25), m.index).toLowerCase();
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 25).toLowerCase();
    const total = /total|con env[ií]o|todo incluido|en total/.test(before + " " + after);
    const shipping = !total && /env[ií]o|porte|transporte/.test(after.slice(0, 15) + " " + before.slice(-12));
    const unit = !total && !shipping && /unidad|cada|c\/u|\bud\b|la pieza|el pack/.test(after + " " + before.slice(-12));
    out.push({ value: v, raw, index: m.index, total, kind: total ? "total" : shipping ? "envio" : unit ? "unidad" : null });
  }
  return out;
}

export function extractEtaDays(text) {
  const t = text.toLowerCase();
  let m = /(\d{1,2})\s*(?:-|a|o)\s*(\d{1,2})\s*d[ií]as/.exec(t);
  if (m) return Number(m[2]);
  m = /(\d{1,2})\s*d[ií]as/.exec(t);
  if (m) return Number(m[1]);
  m = /(\d{1,2})\s*semanas?/.exec(t);
  if (m) return Number(m[1]) * 7;
  if (/\bma[ñn]ana\b/.test(t)) return 1;
  if (/\bhoy\b/.test(t)) return 0;
  if (/\buna semana\b/.test(t)) return 7;
  return null;
}

export function extractOrderRefs(text) {
  return [...new Set((String(text).match(/#\s?(\d{3,7})\b/g) || []).map((s) => "#" + s.replace(/\D/g, "")))];
}

// Resultado: { orderRefs, available, price, priceIsTotal, prices, etaDays, tracking, carrier, status, problem, confidence, ambiguous, reasons[] }
export function parseSupplierReplyRules(text) {
  const reasons = [];
  const neg = NEG.test(text);
  const pos = POS.test(text);
  let available = null;
  if (neg && !pos) available = false;
  else if (pos && !neg) available = true;
  else if (pos && neg) reasons.push("Mensaje con señales contradictorias de disponibilidad");

  const prices = extractPrices(text);
  let price = null, priceIsTotal = false, unitPrice = null, shippingPrice = null;
  const byKind = (k) => prices.filter((p) => p.kind === k);
  if (prices.length === 1) {
    price = prices[0].value; priceIsTotal = prices[0].total;
    if (prices[0].kind === "envio") { price = null; shippingPrice = prices[0].value; }
  } else if (prices.length > 1) {
    const totals = byKind("total");
    if (totals.length === 1) { price = totals[0].value; priceIsTotal = true; }
    else if (prices.length === 2 && byKind("envio").length === 1) {
      // "8€ la unidad y 3€ de envío": precio unitario + envío; el total lo calcula el sistema con la cantidad.
      shippingPrice = byKind("envio")[0].value;
      unitPrice = prices.find((p) => p.kind !== "envio").value;
    } else reasons.push("Aparecen varios precios y no está claro cuál es el total");
  }
  if ((price != null || unitPrice != null) && available === null && !neg) available = true; // dar precio implica disponibilidad
  if (available === true && !STRONG_POS.test(text) && price == null && unitPrice == null && text.trim().length < 15) reasons.push("Respuesta muy corta: confirma, pero sin precio ni plazo");

  const trackings = findTrackingCandidates(text);
  const tracking = trackings[0] || null;
  if (trackings.length > 1) reasons.push("Aparecen varios posibles números de seguimiento");

  let status = null;
  if (tracking || (SHIPPED.test(text) && tracking)) status = "enviado";
  else if (PREPARING.test(text)) status = "preparando";
  else if (CONFIRM.test(text)) status = "confirmado";
  if (SHIPPED.test(text) && !tracking && /seguimiento|tracking|localizador/i.test(text)) reasons.push("Habla de envío pero no hay un número de seguimiento reconocible");

  const problem = PROBLEM.test(text);
  const signals = [available !== null, price !== null || unitPrice !== null, tracking !== null, status !== null].filter(Boolean).length;
  let confidence = signals === 0 ? 0.2 : 0.55 + 0.1 * signals;
  if (tracking) confidence = Math.min(confidence, tracking.confidence);
  if (reasons.length) confidence = Math.min(confidence, 0.45);

  return {
    orderRefs: extractOrderRefs(text),
    available,
    price,
    priceIsTotal,
    unitPrice,
    shippingPrice,
    prices: prices.map((p) => p.value),
    etaDays: extractEtaDays(text),
    tracking: tracking ? tracking.number : null,
    carrier: tracking?.carrier || detectCarrierName(text),
    status,
    problem,
    confidence: Number(confidence.toFixed(2)),
    ambiguous: reasons.length > 0 || signals === 0,
    reasons,
    engine: "reglas",
  };
}

const CLAUDE_PROMPT = `Eres un asistente que interpreta mensajes de WhatsApp de un proveedor de dropshipping en España.
Devuelve SOLO un objeto JSON con estas claves:
{"available": true|false|null, "price": número|null, "price_is_total": true|false, "eta_days": número|null,
 "tracking": "texto exacto"|null, "carrier": "texto"|null, "status": "confirmado"|"preparando"|"enviado"|null,
 "problem": true|false, "ambiguous": true|false, "reason": "explicación corta en español"}
Reglas: no inventes nada. Si un dato no aparece claramente en el mensaje, usa null. "tracking" debe copiarse
exactamente como aparece. Marca "ambiguous": true si el mensaje admite varias interpretaciones.`;

export async function parseSupplierReply(text, { config, fetchImpl = globalThis.fetch, context = "" } = {}) {
  const rules = parseSupplierReplyRules(text);
  if (!config?.claude?.configured || config.demo || (!rules.ambiguous && rules.confidence >= 0.7)) return rules;

  try {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(25000),
      headers: { "x-api-key": config.claude.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: config.claude.model,
        max_tokens: 400,
        system: CLAUDE_PROMPT,
        messages: [{ role: "user", content: `${context ? "Contexto: " + context + "\n\n" : ""}Mensaje del proveedor:\n"""${text}"""` }],
      }),
    });
    if (!res.ok) throw new Error(`Claude HTTP ${res.status}`);
    const j = await res.json();
    const out = j.content?.find((c) => c.type === "text")?.text || "";
    const ai = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
    return mergeWithClaude(text, rules, ai);
  } catch (e) {
    return { ...rules, reasons: [...rules.reasons, `Claude no disponible: ${e.message}`] };
  }
}

// Contrasta la respuesta de Claude con el texto: descarta datos que no aparezcan en el mensaje.
export function mergeWithClaude(text, rules, ai) {
  const reasons = [...rules.reasons];
  const compact = text.toUpperCase().replace(/[\s-]/g, "");
  let tracking = rules.tracking;
  if (ai.tracking) {
    const t = String(ai.tracking).toUpperCase().replace(/[\s-]/g, "");
    if (compact.includes(t)) tracking = tracking || t;
    else reasons.push("Claude propuso un seguimiento que no aparece en el mensaje: descartado");
  }
  let price = rules.price;
  if (price == null && typeof ai.price === "number") {
    const found = rules.prices.includes(ai.price) || new RegExp(`\\b${String(ai.price).replace(".", "[.,]")}\\b`).test(text);
    if (found) price = ai.price;
    else reasons.push("Claude propuso un precio que no aparece en el mensaje: descartado");
  }
  const merged = {
    ...rules,
    available: rules.available ?? (typeof ai.available === "boolean" ? ai.available : null),
    price,
    priceIsTotal: rules.price != null ? rules.priceIsTotal : !!ai.price_is_total,
    etaDays: rules.etaDays ?? (Number.isFinite(ai.eta_days) ? ai.eta_days : null),
    tracking,
    carrier: rules.carrier || ai.carrier || null,
    status: rules.status || ai.status || null,
    problem: rules.problem || !!ai.problem,
    engine: "reglas+claude",
    reasons: ai.reason ? [...reasons, `Claude: ${ai.reason}`] : reasons,
  };
  const conflict = rules.available != null && typeof ai.available === "boolean" && rules.available !== ai.available;
  if (conflict) merged.reasons.push("Las reglas y Claude no coinciden en la disponibilidad");
  merged.ambiguous = !!ai.ambiguous || conflict || reasons.length > rules.reasons.length || (merged.available == null && merged.status == null && !merged.tracking);
  merged.confidence = merged.ambiguous ? Math.min(0.5, rules.confidence) : Math.max(rules.confidence, 0.7);
  return merged;
}
