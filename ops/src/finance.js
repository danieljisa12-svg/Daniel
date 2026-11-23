// Agente financiero: facturación ≠ beneficio.
// Beneficio estimado = ventas sin IVA − coste proveedor − comisiones de pago − publicidad atribuida.
// Cuando falta un dato se indica en "missing" en lugar de suponer un cero.
const r2 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

export function orderEconomics(db, config, order, { supplierCost } = {}) {
  const vat = Number(db.setting("vat_percent", 21));
  const missing = [];
  const revenueGross = Number(order.total_price) || 0;
  const revenueNet = vat > 0 ? revenueGross / (1 + vat / 100) : revenueGross;

  let cost = supplierCost ?? order.supplier_total_cost;
  if (cost == null) {
    const items = db.all(
      `SELECT oi.quantity, sp.unit_cost, sp.shipping_cost FROM order_items oi
       LEFT JOIN supplier_products sp ON sp.id = oi.supplier_product_id WHERE oi.order_id = ?`, order.id);
    if (items.length && items.every((i) => i.unit_cost != null)) {
      cost = items.reduce((a, i) => a + i.unit_cost * i.quantity, 0) + Math.max(0, ...items.map((i) => i.shipping_cost ?? 0));
      missing.push("coste del proveedor estimado con el catálogo (no confirmado)");
    } else missing.push("coste del proveedor");
  }

  const fees = revenueGross * (config.finance.paymentFeePercent / 100) + config.finance.paymentFeeFixed;

  // Publicidad: gasto del día repartido entre los pedidos de ese día.
  const day = String(order.created_at).slice(0, 10);
  const spend = db.get("SELECT sum(amount) AS s, count(*) AS n FROM ad_spend WHERE day = ?", day);
  const ordersThatDay = db.get("SELECT count(*) AS n FROM orders WHERE substr(created_at,1,10) = ? AND status != 'cancelado'", day)?.n || 1;
  const ads = spend?.n ? (spend.s || 0) / ordersThatDay : null;
  if (ads == null) missing.push("gasto publicitario del día");

  const profit = cost == null ? null : revenueNet - cost - fees - (ads || 0);
  return {
    revenueGross: r2(revenueGross),
    revenueNet: r2(revenueNet),
    supplierCost: r2(cost),
    paymentFees: r2(fees),
    adsAllocated: r2(ads),
    profit: r2(profit),
    marginPercent: profit == null || revenueNet === 0 ? null : Math.round((profit / revenueNet) * 1000) / 10,
    missing,
  };
}

// Resumen de un periodo [from, to) en fechas YYYY-MM-DD.
export function periodSummary(db, config, from, to) {
  const orders = db.all(
    "SELECT * FROM orders WHERE substr(created_at,1,10) >= ? AND substr(created_at,1,10) < ? AND status != 'cancelado'", from, to);
  const vat = Number(db.setting("vat_percent", 21));
  let gross = 0, net = 0, cost = 0, fees = 0, profit = 0, costKnown = 0;
  const byProduct = new Map();
  for (const o of orders) {
    const e = orderEconomics(db, config, o);
    gross += e.revenueGross; net += e.revenueNet; fees += e.paymentFees;
    if (e.supplierCost != null) { cost += e.supplierCost; costKnown++; profit += e.revenueNet - e.supplierCost - e.paymentFees; }
    for (const it of db.all("SELECT title, quantity, unit_price FROM order_items WHERE order_id = ?", o.id)) {
      const k = it.title;
      const p = byProduct.get(k) || { title: k, units: 0, revenue: 0 };
      p.units += it.quantity; p.revenue += it.quantity * it.unit_price;
      byProduct.set(k, p);
    }
  }
  const adSpend = db.get("SELECT sum(amount) AS s, count(*) AS n FROM ad_spend WHERE day >= ? AND day < ?", from, to);
  const ads = adSpend?.s || 0;
  const missing = [];
  if (orders.length && costKnown < orders.length) missing.push(`${orders.length - costKnown} pedido(s) sin coste de proveedor`);
  if (!adSpend?.n) missing.push("gasto publicitario (conecta Meta Ads o regístralo a mano)");
  return {
    from, to,
    orders: orders.length,
    revenueGross: r2(gross),
    revenueNet: r2(net),
    vatPercent: vat,
    supplierCost: r2(cost),
    paymentFees: r2(fees),
    adSpend: r2(ads),
    profitEstimate: costKnown ? r2(profit - ads) : null,
    cac: orders.length && adSpend?.n ? r2(ads / orders.length) : null,
    roas: ads > 0 ? r2(gross / ads) : null,
    topProducts: [...byProduct.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5).map((p) => ({ ...p, revenue: r2(p.revenue) })),
    missing,
  };
}
