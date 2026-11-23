// Agente investigador · Puntuación de productos candidatos.
//
// Cada criterio se puntúa de 0 a 5 (lo rellena la investigación o tú) y tiene un peso.
// Puntuación final = Σ(nota × peso) / Σ(5 × pesos de los criterios con dato) × 100.
// Los criterios sin dato NO cuentan como cero: bajan la "confianza" y se listan como pendientes.
//
// Además hay BLOQUEOS que impiden publicar aunque la puntuación sea alta:
//   - proveedor sin verificar (disponibilidad, coste, envío, plazos)
//   - requisitos legales/seguridad sin revisar (CE, etiquetado, baterías, cosmética, juguetes…)
// Un producto investigado no es un producto disponible.
import { proposePrices } from "./pricing.js";

export const CRITERIA = [
  { id: "demanda", label: "Demanda", weight: 3, help: "Búsquedas, tendencias y vídeos con interacción real (fuentes citadas)" },
  { id: "competencia", label: "Competencia (5 = poca)", weight: 2, help: "Saturación de tiendas y anuncios iguales" },
  { id: "diferenciacion", label: "Diferenciación", weight: 2, help: "Ángulo, pack o marca que nos separa de la copia" },
  { id: "margen", label: "Margen", weight: 3, help: "Se calcula solo si hay coste y envío; si no, queda pendiente" },
  { id: "potencial_publicitario", label: "Potencial publicitario", weight: 3, help: "¿Se entiende en 3 s de vídeo? Efecto 'wow' o problema visible" },
  { id: "transporte", label: "Facilidad de transporte", weight: 1, help: "Pequeño, ligero, no frágil, sin líquidos peligrosos" },
  { id: "devoluciones", label: "Riesgo de devolución (5 = bajo)", weight: 2, help: "Tallas, expectativas, fragilidad" },
  { id: "precio", label: "Precio de venta", weight: 1, help: "Zona 25–60 €: compra impulsiva con margen para publicidad" },
  { id: "visuales", label: "Calidad del material visual", weight: 1, help: "Fotos/vídeos del proveedor utilizables" },
  { id: "proveedor", label: "Viabilidad con el proveedor", weight: 2, help: "5 solo si el proveedor lo ha confirmado por escrito" },
  { id: "legal", label: "Requisitos legales (5 = simples)", weight: 1, help: "Normativa aplicable y documentación disponible" },
];

const clamp = (v) => Math.max(0, Math.min(5, v));

// Nota de margen a partir del margen de contribución (%) del precio recomendado.
export function marginScore(contributionPercent) {
  if (contributionPercent == null) return null;
  if (contributionPercent >= 45) return 5;
  if (contributionPercent >= 35) return 4;
  if (contributionPercent >= 28) return 3;
  if (contributionPercent >= 20) return 2;
  if (contributionPercent >= 10) return 1;
  return 0;
}

export function scoreCandidate(c) {
  const scores = { ...(c.scores || {}) };
  let pricing = null;
  if (c.supplierCost != null && c.shippingCost != null) {
    pricing = proposePrices({ supplierCost: c.supplierCost, shippingCost: c.shippingCost, competitorPrices: c.competitorPrices || [] });
    const rec = pricing.proposals.find((p) => p.tier === pricing.recommendation);
    scores.margen = marginScore(rec?.contributionPercent);
  } else {
    delete scores.margen; // nunca se estima el margen sin coste real
  }

  let got = 0, max = 0, totalWeight = 0;
  const pending = [];
  for (const k of CRITERIA) {
    totalWeight += k.weight;
    const v = scores[k.id];
    if (v == null || !Number.isFinite(Number(v))) { pending.push(k.label); continue; }
    got += clamp(Number(v)) * k.weight;
    max += 5 * k.weight;
  }
  const score = max ? Math.round((got / max) * 100) : null;
  const confidence = Math.round((max / (5 * totalWeight)) * 100);

  const blockers = [];
  const sv = c.supplierVerified || {};
  const needed = { disponibilidad: sv.availability, coste: sv.cost, envio: sv.shipping, plazos: sv.leadTime, devoluciones: sv.returns };
  const notVerified = Object.entries(needed).filter(([, ok]) => !ok).map(([k]) => k);
  if (notVerified.length) blockers.push(`Proveedor sin confirmar: ${notVerified.join(", ")}`);
  if (!c.complianceChecked) blockers.push("Requisitos de seguridad y conformidad sin revisar");

  const status = blockers.length ? "candidato" : "listo_para_borrador";
  return { id: c.id, name: c.name, score, confidence, pending, blockers, status, pricing, scores };
}

// Orden: primero la puntuación; a igualdad, la confianza.
export function rankCandidates(list) {
  return list.map(scoreCandidate).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.confidence - a.confidence);
}
