// Registra (si faltan) los webhooks de Shopify en PUBLIC_URL. El servidor también lo hace solo al arrancar.
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { createShopifyClient } from "../src/shopify/client.js";
import { ensureWebhooks } from "../src/setup.js";
const config = loadConfig();
if (!config.shopify.configured) { console.error("Faltan SHOPIFY_SHOP / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET"); process.exit(1); }
const r = await ensureWebhooks(openDb(config.dataDir), config, createShopifyClient(config));
console.log(r.created.length ? `Registrados: ${r.created.join(", ")}` : "Los webhooks ya estaban registrados.");
if (r.stale.length) console.log("Aviso: hay webhooks apuntando a otras URL:", r.stale.join(", "));
