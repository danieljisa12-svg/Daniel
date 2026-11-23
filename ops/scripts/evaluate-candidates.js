// Ordena productos candidatos por puntuación y muestra precios propuestos.
// Uso: node scripts/evaluate-candidates.js ../palazzo/productos/candidatos.json
import fs from "node:fs";
import { rankCandidates, CRITERIA } from "../src/commerce/scoring.js";

const file = process.argv[2];
if (!file) { console.error("Uso: node scripts/evaluate-candidates.js <candidatos.json>"); process.exit(1); }
const list = JSON.parse(fs.readFileSync(file, "utf8")).candidates;
const eur = (v) => (v == null ? "—" : v.toFixed(2).replace(".", ",") + " €");

console.log(`Criterios y pesos: ${CRITERIA.map((c) => `${c.label} ×${c.weight}`).join(" · ")}\n`);
for (const r of rankCandidates(list)) {
  console.log(`■ ${r.name}  →  ${r.score ?? "sin datos"}/100  (confianza ${r.confidence} %)  [${r.status}]`);
  if (r.pricing?.complete) {
    for (const p of r.pricing.proposals)
      console.log(`   ${p.tier === r.pricing.recommendation ? "★" : " "} ${p.label.padEnd(18)} ${eur(p.price).padStart(9)} · margen ${p.contributionPercent} % · CPA equilibrio ${eur(p.breakevenCPA)} · ROAS equilibrio ${p.breakevenROAS}`);
  }
  if (r.blockers.length) console.log(`   ⛔ ${r.blockers.join(" | ")}`);
  if (r.pending.length) console.log(`   … pendiente: ${r.pending.join(", ")}`);
  console.log();
}
