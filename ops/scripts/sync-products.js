// Copia las variantes activas de Shopify al catálogo del proveedor (sin tocar costes ya rellenados).
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { createShopifyClient } from "../src/shopify/client.js";
import { syncCatalog } from "../src/shopify/catalog.js";
const config = loadConfig();
if (!config.shopify.configured) { console.error("Faltan credenciales de Shopify"); process.exit(1); }
const r = await syncCatalog(openDb(config.dataDir), createShopifyClient(config));
console.log(`Catálogo: ${r.added} nuevas, ${r.updated} actualizadas, ${r.skipped} productos de servicio omitidos.`);
