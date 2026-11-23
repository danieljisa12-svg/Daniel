// Datos de demostración (ficticios). Solo se cargan con DEMO_MODE=1 o en las pruebas.
export function seedDemo(db) {
  if (db.get("SELECT id FROM suppliers LIMIT 1")) return;
  db.run("INSERT INTO suppliers(name, whatsapp, consent_at, consent_note) VALUES(?,?,datetime('now'),?)",
    "Proveedor demo", "34600000000", "Demo: consentimiento simulado");
  const sid = db.get("SELECT id FROM suppliers LIMIT 1").id;
  const rows = [
    ["gid://shopify/ProductVariant/56669830054230", "CALORA-1P", "Calora® Calentador de Manos Recargable 2 en 1", "1 pack (2 piezas)", "HW-SPLIT-2", 8.4, 3.5, 1, 15],
    ["gid://shopify/ProductVariant/56669830086998", "CALORA-2P", "Calora® Calentador de Manos Recargable 2 en 1", "2 packs (4 piezas) · Regalo doble", "HW-SPLIT-2x2", 15.9, 3.5, 0, null],
    ["gid://shopify/ProductVariant/1001", null, "Paraguas Nublo®", "Negro", "UMB-NB-BLK", 9.0, 3.0, 0, null],
  ];
  for (const r of rows)
    db.run(`INSERT INTO supplier_products(shopify_variant_id, sku, title, variant_title, supplier_ref, unit_cost, shipping_cost, auto_order, auto_max_amount, supplier_id)
            VALUES(?,?,?,?,?,?,?,?,?,?)`, ...r, sid);
}

export function demoOrderPayload(n, { test = true, variant = 56669830054230, qty = 1, price = "29.95", title = "Calora® Calentador de Manos Recargable 2 en 1", variantTitle = "1 pack (2 piezas)", sku = "CALORA-1P", extra = [] } = {}) {
  return {
    id: 7000000000 + n,
    admin_graphql_api_id: `gid://shopify/Order/${7000000000 + n}`,
    name: `#${n}`,
    order_number: n,
    email: "cliente.demo@example.com",
    financial_status: "paid",
    currency: "EUR",
    total_price: String((Number(price) * qty + extra.reduce((a, e) => a + Number(e.price), 0)).toFixed(2)),
    created_at: new Date().toISOString(),
    test,
    customer: { first_name: "Lucía", last_name: "Demo" },
    shipping_address: { name: "Lucía Demo", address1: "Calle Falsa 123", address2: "2ºB", zip: "28001", city: "Madrid", province: "Madrid", country: "Spain", phone: "+34 600 000 001" },
    shipping_lines: [{ price: "0.00" }],
    line_items: [
      { id: 1, variant_id: variant, sku, title, variant_title: variantTitle, quantity: qty, price, requires_shipping: true },
      ...extra.map((e, i) => ({ id: 10 + i, variant_id: e.variant_id ?? null, sku: null, title: e.title, variant_title: null, quantity: 1, price: e.price, requires_shipping: true })),
    ],
  };
}
