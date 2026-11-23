// Convierte el JSON del webhook orders/paid de Shopify en nuestro formato interno.
// Solo se guardan los datos personales imprescindibles para que el proveedor envíe el paquete.
const n = (v) => (v == null || v === "" ? 0 : Number(v));

export function normalizeOrderWebhook(p) {
  if (!p || !p.id || !Array.isArray(p.line_items)) throw new Error("Payload de pedido no válido");
  const sa = p.shipping_address || {};
  const shippingPrice = n(p.total_shipping_price_set?.shop_money?.amount ?? (p.shipping_lines || []).reduce((a, l) => a + n(l.price), 0));
  return {
    shopifyOrderId: p.admin_graphql_api_id || `gid://shopify/Order/${p.id}`,
    name: p.name || `#${p.order_number ?? p.id}`,
    financialStatus: p.financial_status || null,
    currency: p.currency || "EUR",
    totalPrice: n(p.current_total_price ?? p.total_price),
    shippingPrice,
    createdAt: p.created_at || new Date().toISOString(),
    test: !!p.test,
    cancelled: !!p.cancelled_at,
    customer: {
      name: [p.customer?.first_name, p.customer?.last_name].filter(Boolean).join(" ") || null,
      email: p.email || p.customer?.email || null,
    },
    shipping: {
      name: sa.name || [sa.first_name, sa.last_name].filter(Boolean).join(" ") || null,
      address1: sa.address1 || null,
      address2: sa.address2 || null,
      zip: sa.zip || null,
      city: sa.city || null,
      province: sa.province || null,
      country: sa.country || null,
      phone: sa.phone || p.phone || null,
    },
    items: p.line_items
      .filter((li) => li.requires_shipping !== false && li.quantity > 0)
      .map((li) => ({
        lineItemId: String(li.id),
        variantId: li.variant_id ? `gid://shopify/ProductVariant/${li.variant_id}` : null,
        sku: li.sku || null,
        title: li.title,
        variantTitle: li.variant_title && li.variant_title !== "Default Title" ? li.variant_title : null,
        quantity: Number(li.quantity),
        unitPrice: n(li.price),
      })),
  };
}
