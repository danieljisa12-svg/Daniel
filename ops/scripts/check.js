// Diagnóstico completo desde la terminal: npm run check
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/app.js";
import { diagnostics } from "../src/setup.js";
const app = createApp(loadConfig());
const d = await diagnostics(app);
for (const c of d.checks) {
  const icon = c.ok === true ? "✔" : c.ok === false ? "✖" : "•";
  console.log(`${icon} ${c.name}: ${c.detail}`);
  if (c.ok === false && c.fix) console.log(`    → ${c.fix}`);
}
console.log(d.ready ? "\nListo para funcionar." : "\nHay puntos por resolver (✖).");
app.stop();
process.exit(d.ready ? 0 : 1);
