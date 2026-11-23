// Agente financiero · Precios de producto (España, IVA incluido en el precio de venta).
//
// Distingue tres niveles que no deben confundirse:
//   1. Ingreso neto        = precio con IVA / (1 + IVA)
//   2. Margen de contribución (antes de publicidad)
//                          = ingreso neto − coste proveedor − envío − comisión de pago − reserva de devoluciones
//   3. Beneficio por venta = margen de contribución − coste de captación (CPA real)
// El "CPA de equilibrio" es el margen de contribución: si un anuncio cuesta más por venta, se pierde dinero.
// Ninguna función cambia precios en Shopify: solo calcula propuestas que pasan por Aprobaciones.

const r2 = (v) => Math.round(v * 100) / 100;

export const PRICING_DEFAULTS = {
  vatPercent: 21,
  // Comisión de la pasarela. Valores PROVISIONALES: compruébalos en Shopify → Configuración → Pagos.
  paymentFeePercent: 2.1,
  paymentFeeFixed: 0.25,
  returnRatePercent: 5,      // % de pedidos que se estima que se devuelven (sin histórico propio todavía)
  returnCostPerUnit: null,   // coste de gestionar una devolución; si falta se usa el envío
  minContributionPercent: 25,
};

const TIERS = [
  { id: "competitivo", targetPercent: 25, label: "Precio competitivo" },
  { id: "equilibrado", targetPercent: 35, label: "Precio equilibrado" },
  { id: "premium", targetPercent: 45, label: "Precio premium" },
];

// Redondeo comercial habitual en España: termina en ,95 (o ,90 si se pasa por poco).
export function charmPrice(p) {
  if (!Number.isFinite(p) || p <= 0) return null;
  const base = Math.floor(p);
  const c95 = base + 0.95;
  if (c95 >= p) return r2(c95);
  return r2(base + 1.95);
}

function check(input) {
  const missing = [];
  // Ojo: en JS `null >= 0` es true; se exige un número real para no tratar "sin dato" como 0 €.
  const ok = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (!ok(input.supplierCost)) missing.push("coste del proveedor");
  if (!ok(input.shippingCost)) missing.push("coste de envío del proveedor");
  return missing;
}

// Desglose para un precio concreto.
export function unitEconomics(price, input, opts = {}) {
  const o = { ...PRICING_DEFAULTS, ...opts };
  const missing = check(input);
  if (missing.length) return { price, missing, complete: false };
  const net = price / (1 + o.vatPercent / 100);
  const vat = price - net;
  const fee = price * (o.paymentFeePercent / 100) + o.paymentFeeFixed;
  const returnCost = o.returnCostPerUnit ?? input.shippingCost;
  const returnsReserve = (o.returnRatePercent / 100) * (returnCost + input.shippingCost);
  const contribution = net - input.supplierCost - input.shippingCost - fee - returnsReserve;
  return {
    price: r2(price),
    complete: true,
    missing: [],
    vat: r2(vat),
    netRevenue: r2(net),
    supplierCost: r2(input.supplierCost),
    shippingCost: r2(input.shippingCost),
    paymentFee: r2(fee),
    returnsReserve: r2(returnsReserve),
    contribution: r2(contribution),
    contributionPercent: net > 0 ? Math.round((contribution / net) * 1000) / 10 : null,
    breakevenCPA: r2(Math.max(0, contribution)),
    // ROAS de equilibrio sobre ventas con IVA (como lo muestran Meta/Google/TikTok).
    breakevenROAS: contribution > 0 ? Math.round((price / contribution) * 100) / 100 : null,
  };
}

// Precio mínimo para alcanzar un % de margen de contribución sobre el ingreso neto.
// Ecuación lineal en p:  p/(1+v)·(1 − m) − p·f = coste + envío + fijo + reserva
export function priceForContribution(targetPercent, input, opts = {}) {
  const o = { ...PRICING_DEFAULTS, ...opts };
  if (check(input).length) return null;
  const v = 1 + o.vatPercent / 100;
  const m = targetPercent / 100;
  const f = o.paymentFeePercent / 100;
  const returnCost = o.returnCostPerUnit ?? input.shippingCost;
  const fixed = input.supplierCost + input.shippingCost + o.paymentFeeFixed + (o.returnRatePercent / 100) * (returnCost + input.shippingCost);
  const k = (1 - m) / v - f;
  if (k <= 0) return null;
  return fixed / k;
}

// Tres propuestas razonadas + recomendación. competitorPrices: precios con IVA vistos en el mercado (opcional).
export function proposePrices(input, opts = {}) {
  const o = { ...PRICING_DEFAULTS, ...opts };
  const missing = check(input);
  if (missing.length) {
    return { complete: false, missing, proposals: [], recommendation: null, notes: ["Sin coste y envío reales no se propone precio: pídelos al proveedor."] };
  }
  const comps = (input.competitorPrices || []).filter((x) => x > 0).sort((a, b) => a - b);
  const median = comps.length ? comps[Math.floor((comps.length - 1) / 2)] : null;

  const proposals = TIERS.map((t) => {
    const price = charmPrice(priceForContribution(t.targetPercent, input, o));
    return { tier: t.id, label: t.label, targetPercent: t.targetPercent, ...unitEconomics(price, input, o) };
  });

  const notes = [];
  let pick = proposals.find((p) => p.tier === "equilibrado");
  if (median != null) {
    // Mejor precio que no supere la mediana de la competencia manteniendo el margen mínimo.
    const viable = proposals.filter((p) => p.price <= median && p.contributionPercent >= o.minContributionPercent);
    if (viable.length) {
      pick = viable[viable.length - 1];
      notes.push(`Mediana de la competencia: ${median.toFixed(2)} €. Se elige el precio más alto que no la supera.`);
    } else {
      notes.push(`Ni el precio competitivo cabe por debajo de la mediana de la competencia (${median.toFixed(2)} €) con un margen del ${o.minContributionPercent} %: el producto necesita diferenciación clara, un pack o un coste menor.`);
      pick = proposals[0];
    }
  } else {
    notes.push("Sin precios de competencia verificados: se recomienda el precio equilibrado.");
  }
  if (pick.breakevenCPA < 12) notes.push(`CPA de equilibrio de ${pick.breakevenCPA.toFixed(2)} €: muy justo para publicidad de pago. Valora subir precio con un pack.`);
  notes.push("Comisiones y tasa de devolución son supuestos provisionales hasta tener datos reales.");

  return { complete: true, missing: [], competitorMedian: median, proposals, recommendation: pick.tier, notes };
}
