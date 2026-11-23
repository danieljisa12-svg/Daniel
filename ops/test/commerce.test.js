import { test } from "node:test";
import assert from "node:assert/strict";
import { unitEconomics, priceForContribution, proposePrices, charmPrice } from "../src/commerce/pricing.js";
import { scoreCandidate, rankCandidates, marginScore } from "../src/commerce/scoring.js";

const base = { supplierCost: 8, shippingCost: 4 };

test("precio: IVA, comisión y margen de contribución cuadran", () => {
  const e = unitEconomics(29.95, base);
  assert.equal(e.complete, true);
  assert.equal(e.netRevenue, 24.75);               // 29,95 / 1,21
  assert.equal(e.vat, 5.2);
  assert.equal(e.paymentFee, 0.88);                // 2,1 % + 0,25
  assert.equal(e.returnsReserve, 0.4);             // 5 % × (4 + 4)
  assert.equal(e.contribution, 11.47);
  assert.equal(e.breakevenCPA, 11.47);
  assert.ok(e.breakevenROAS > 2.6 && e.breakevenROAS < 2.62);
});

test("precio: el precio calculado alcanza el margen objetivo", () => {
  const p = priceForContribution(35, base);
  const e = unitEconomics(p, base);
  assert.ok(Math.abs(e.contributionPercent - 35) < 0.2);
});

test("precio: redondeo comercial a ,95", () => {
  assert.equal(charmPrice(27.2), 27.95);
  assert.equal(charmPrice(27.96), 28.95);
});

test("precio: sin coste real no se propone nada", () => {
  const r = proposePrices({ supplierCost: null, shippingCost: 4 });
  assert.equal(r.complete, false);
  assert.deepEqual(r.missing, ["coste del proveedor"]);
  assert.equal(r.proposals.length, 0);
});

test("precio: tres propuestas crecientes y recomendación por competencia", () => {
  const r = proposePrices({ ...base, competitorPrices: [34.9, 39.9, 44.9] });
  assert.equal(r.proposals.length, 3);
  assert.ok(r.proposals[0].price < r.proposals[1].price && r.proposals[1].price < r.proposals[2].price);
  const rec = r.proposals.find((p) => p.tier === r.recommendation);
  assert.ok(rec.price <= 39.9);
  assert.ok(rec.contributionPercent >= 25);
});

test("puntuación: sin coste el margen queda pendiente y sin proveedor queda bloqueado", () => {
  const s = scoreCandidate({ id: "x", name: "X", scores: { demanda: 4, margen: 5, potencial_publicitario: 5 } });
  assert.equal(s.scores.margen, undefined);
  assert.ok(s.pending.includes("Margen"));
  assert.equal(s.status, "candidato");
  assert.ok(s.blockers[0].startsWith("Proveedor sin confirmar"));
  assert.ok(s.confidence < 50);
});

test("puntuación: candidato verificado puede pasar a borrador y se ordena", () => {
  const ok = {
    id: "a", name: "A", supplierCost: 8, shippingCost: 4, complianceChecked: true,
    supplierVerified: { availability: true, cost: true, shipping: true, leadTime: true, returns: true },
    scores: { demanda: 4, competencia: 3, diferenciacion: 4, potencial_publicitario: 5, transporte: 5, devoluciones: 4, precio: 4, visuales: 3, proveedor: 5, legal: 4 },
  };
  const weak = { id: "b", name: "B", scores: { demanda: 2, potencial_publicitario: 2 } };
  const [first, second] = rankCandidates([weak, ok]);
  assert.equal(first.id, "a");
  assert.equal(first.status, "listo_para_borrador");
  assert.equal(first.confidence, 100);
  assert.equal(second.id, "b");
  assert.equal(marginScore(46), 5);
  assert.equal(marginScore(null), null);
});
