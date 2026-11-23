// Cliente de la GraphQL Admin API de Shopify con el "client credentials grant"
// (app creada en el Dev Dashboard e instalada en tu propia tienda). El token dura 24 h y se renueva solo.
export function createShopifyClient(config, fetchImpl = globalThis.fetch) {
  const { shop, clientId, clientSecret, apiVersion } = config.shopify;
  const base = `https://${shop}.myshopify.com`;
  let token = null;
  let tokenExpiresAt = 0;

  async function getToken() {
    if (token && Date.now() < tokenExpiresAt - 5 * 60 * 1000) return token;
    const res = await fetchImpl(`${base}/admin/oauth/access_token`, {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
    });
    if (!res.ok) throw new Error(`Shopify: no se pudo obtener el token (${res.status}) ${await safeText(res)}`);
    const j = await res.json();
    token = j.access_token;
    tokenExpiresAt = Date.now() + (Number(j.expires_in) || 86399) * 1000;
    return token;
  }

  async function graphql(query, variables = {}) {
    if (!config.shopify.configured) throw new Error("Shopify no está configurado (faltan SHOPIFY_SHOP / CLIENT_ID / CLIENT_SECRET)");
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetchImpl(`${base}/admin/api/${apiVersion}/graphql.json`, {
        method: "POST",
        signal: AbortSignal.timeout(30000),
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await getToken() },
        body: JSON.stringify({ query, variables }),
      });
      if (res.status === 401) { token = null; continue; }
      if (res.status === 429 || res.status >= 500) { await sleep(1000 * 2 ** attempt); continue; }
      if (!res.ok) throw new Error(`Shopify GraphQL ${res.status}: ${await safeText(res)}`);
      const j = await res.json();
      if (j.errors?.length) {
        const throttled = j.errors.some((e) => e.extensions?.code === "THROTTLED");
        if (throttled) { await sleep(1000 * 2 ** attempt); continue; }
        throw new Error("Shopify GraphQL: " + JSON.stringify(j.errors));
      }
      return j.data;
    }
    throw new Error("Shopify GraphQL: demasiados reintentos");
  }

  return {
    graphql,

    // Estado de pago real del pedido (doble comprobación además del webhook).
    async getOrderPaymentStatus(orderGid) {
      const d = await graphql(`query($id: ID!) { order(id: $id) { id name displayFinancialStatus cancelledAt test } }`, { id: orderGid });
      return d.order;
    },

    // Crea el envío en Shopify con el número de seguimiento y avisa al cliente.
    // Requiere el scope write_merchant_managed_fulfillment_orders.
    async createFulfillmentWithTracking(orderGid, { number, company, url }, notifyCustomer = true) {
      const d = await graphql(
        `query($id: ID!) { order(id: $id) { fulfillmentOrders(first: 10) { nodes { id status } } } }`,
        { id: orderGid }
      );
      const open = d.order.fulfillmentOrders.nodes.filter((f) => ["OPEN", "IN_PROGRESS"].includes(f.status));
      if (!open.length) throw new Error("El pedido no tiene órdenes de preparación abiertas (¿ya estaba enviado o cancelado?)");
      const r = await graphql(
        `mutation($fulfillment: FulfillmentInput!) {
          fulfillmentCreate(fulfillment: $fulfillment) {
            fulfillment { id status }
            userErrors { field message }
          }
        }`,
        {
          fulfillment: {
            lineItemsByFulfillmentOrder: open.map((f) => ({ fulfillmentOrderId: f.id })),
            trackingInfo: { number, company: company || undefined, url: url || undefined },
            notifyCustomer,
          },
        }
      );
      const errs = r.fulfillmentCreate.userErrors;
      if (errs?.length) throw new Error("Shopify rechazó el envío: " + errs.map((e) => e.message).join("; "));
      return r.fulfillmentCreate.fulfillment;
    },

    async listProducts(after = null) {
      return graphql(
        `query($after: String) {
          products(first: 50, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { id title status variants(first: 50) { nodes { id title sku price inventoryItem { unitCost { amount } } } } }
          }
        }`,
        { after }
      );
    },

    async registerWebhook(topic, callbackUrl) {
      const r = await graphql(
        `mutation($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
          webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
            webhookSubscription { id topic }
            userErrors { field message }
          }
        }`,
        { topic, sub: { uri: callbackUrl, format: "JSON" } }
      );
      return r.webhookSubscriptionCreate;
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function safeText(res) {
  try { return (await res.text()).slice(0, 300); } catch { return ""; }
}
