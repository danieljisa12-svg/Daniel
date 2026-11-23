// Sincroniza las variantes activas de Shopify con el catálogo del proveedor.
// No sobrescribe costes, referencias ni proveedor que ya hayas rellenado.
import { audit } from "../audit.js";
import { DEFAULT_SETTINGS } from "../orders/service.js";

export async function syncCatalog(db, shopify) {
  let pattern;
  try { pattern = new RegExp(db.setting("service_item_pattern", DEFAULT_SETTINGS.service_item_pattern), "i"); } catch { pattern = /^$/; }
  let after = null, added = 0, updated = 0, skipped = 0;
  const seen = new Set();
  do {
    const d = await shopify.listProducts(after);
    for (const p of d.products.nodes) {
      if (p.status !== "ACTIVE") continue;
      if (pattern.test(p.title)) { skipped++; continue; } // "Envío rápido", etc.
      for (const v of p.variants.nodes) {
        seen.add(v.id);
        const cost = v.inventoryItem?.unitCost?.amount != null ? Number(v.inventoryItem.unitCost.amount) : null;
        const exists = db.get("SELECT id FROM supplier_products WHERE shopify_variant_id = ?", v.id);
        db.run(
          `INSERT INTO supplier_products(shopify_variant_id, sku, title, variant_title, unit_cost) VALUES(?,?,?,?,?)
           ON CONFLICT(shopify_variant_id) DO UPDATE SET sku = excluded.sku, title = excluded.title,
             variant_title = excluded.variant_title, unit_cost = coalesce(supplier_products.unit_cost, excluded.unit_cost),
             updated_at = datetime('now')`,
          v.id, v.sku, p.title, v.title === "Default Title" ? null : v.title, cost
        );
        exists ? updated++ : added++;
      }
    }
    after = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
  } while (after);
  const result = { added, updated, skipped, total: seen.size };
  db.setSetting("last_catalog_sync", { at: new Date().toISOString(), ...result });
  audit(db, { action: "catalogo.sincronizar", details: result });
  return result;
}
