// Copia las variantes de Shopify al catálogo del proveedor (sin tocar costes ya rellenados).
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { createShopifyClient } from "../src/shopify/client.js";
import { audit } from "../src/audit.js";
const config = loadConfig();
if (!config.shopify.configured) { console.error("Faltan credenciales de Shopify"); process.exit(1); }
const db = openDb(config.dataDir);
const shopify = createShopifyClient(config);
let after = null, n = 0;
do {
  const d = await shopify.listProducts(after);
  for (const p of d.products.nodes) {
    if (p.status !== "ACTIVE") continue;
    for (const v of p.variants.nodes) {
      const cost = v.inventoryItem?.unitCost?.amount != null ? Number(v.inventoryItem.unitCost.amount) : null;
      db.run(`INSERT INTO supplier_products(shopify_variant_id, sku, title, variant_title, unit_cost)
              VALUES(?,?,?,?,?)
              ON CONFLICT(shopify_variant_id) DO UPDATE SET sku=excluded.sku, title=excluded.title, variant_title=excluded.variant_title,
                unit_cost=coalesce(supplier_products.unit_cost, excluded.unit_cost), updated_at=datetime('now')`,
        v.id, v.sku, p.title, v.title === "Default Title" ? null : v.title, cost);
      n++;
    }
  }
  after = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
} while (after);
audit(db, { action: "catalogo.sincronizar", details: { variants: n } });
console.log(`Sincronizadas ${n} variantes. Asigna proveedor y coste en el panel (Catálogo).`);
