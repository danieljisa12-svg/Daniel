// Da de alta los webhooks en Shopify apuntando a PUBLIC_URL. Ejecutar una vez tras desplegar.
import { loadConfig } from "../src/config.js";
import { createShopifyClient } from "../src/shopify/client.js";
const config = loadConfig();
if (!config.shopify.configured) { console.error("Faltan SHOPIFY_SHOP / SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET"); process.exit(1); }
const shopify = createShopifyClient(config);
const uri = `${config.publicUrl}/webhooks/shopify`;
for (const topic of ["ORDERS_PAID", "ORDERS_CANCELLED"]) {
  const r = await shopify.registerWebhook(topic, uri);
  if (r.userErrors?.length) console.log(topic, "→", r.userErrors.map((e) => e.message).join("; "));
  else console.log(topic, "→ registrado", r.webhookSubscription.id);
}
