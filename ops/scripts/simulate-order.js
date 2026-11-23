// Envía al servidor un webhook orders/paid firmado, como lo haría Shopify. Uso:
//   SHOPIFY_CLIENT_SECRET=... node scripts/simulate-order.js http://localhost:8080 1234
import crypto from "node:crypto";
import { demoOrderPayload } from "./demo-data.js";
const [base = "http://localhost:8080", n = String(1000 + Math.floor(Math.random() * 9000))] = process.argv.slice(2);
const secret = process.env.SHOPIFY_CLIENT_SECRET || "demo-secret";
const body = JSON.stringify(demoOrderPayload(Number(n)));
const hmac = crypto.createHmac("sha256", secret).update(body).digest("base64");
const res = await fetch(`${base}/webhooks/shopify`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Shopify-Topic": "orders/paid", "X-Shopify-Hmac-Sha256": hmac, "X-Shopify-Webhook-Id": crypto.randomUUID() },
  body,
});
console.log(res.status, await res.text());
