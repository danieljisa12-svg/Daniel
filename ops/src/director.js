// Agente director: informe diario, estado de los agentes y prioridades.
import { periodSummary } from "./finance.js";
import { audit } from "./audit.js";

export function localDate(tz, d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
const addDays = (ymd, n) => {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function dailyReport(db, config, day) {
  const fin = periodSummary(db, config, day, addDays(day, 1));
  const pendingApprovals = db.get("SELECT count(*) n FROM approvals WHERE status='pendiente'").n;
  const incidents = db.all("SELECT name, incident FROM orders WHERE status='incidencia' ORDER BY updated_at DESC LIMIT 20");
  const byStatus = db.all("SELECT status, count(*) n FROM orders GROUP BY status");
  const failedJobs = db.get("SELECT count(*) n FROM jobs WHERE status='fallido' AND updated_at >= datetime('now','-1 day')").n;

  // Prioridades ordenadas por impacto económico.
  const priorities = [];
  if (pendingApprovals) priorities.push(`Tienes ${pendingApprovals} aprobación(es) pendiente(s): los pedidos no avanzan hasta que decidas.`);
  if (incidents.length) priorities.push(`${incidents.length} pedido(s) en incidencia: revísalos primero, afectan a clientes que ya han pagado.`);
  if (failedJobs) priorities.push(`${failedJobs} tarea(s) automáticas fallaron en las últimas 24 h.`);
  for (const m of fin.missing) priorities.push(`Falta dato: ${m}.`);
  const unmapped = db.get("SELECT count(*) n FROM supplier_products WHERE unit_cost IS NULL").n;
  if (unmapped) priorities.push(`${unmapped} producto(s) del catálogo sin coste: sin él no se puede calcular el beneficio.`);

  return { day, finance: fin, pendingApprovals, incidents, byStatus, failedJobs, priorities };
}

export async function runDailyReport(db, config, alert, day = null) {
  const target = day || addDays(localDate(config.timezone), -1);
  const rep = dailyReport(db, config, target);
  const r = db.run(
    "INSERT INTO reports(kind, period, data_json) VALUES('diario', ?, ?) ON CONFLICT(kind, period) DO UPDATE SET data_json = excluded.data_json, created_at = datetime('now')",
    target, JSON.stringify(rep)
  );
  audit(db, { actor: "agente:director", action: "informe.diario", details: { day: target } });
  const f = rep.finance;
  const eur = (v) => (v == null ? "sin datos" : `${v.toFixed(2).replace(".", ",")} €`);
  await alert(
    "info",
    `Informe ${target}`,
    `${f.orders} pedidos · ventas ${eur(f.revenueGross)} · beneficio est. ${eur(f.profitEstimate)} · ${rep.pendingApprovals} aprobaciones pendientes`
  );
  return rep;
}

// Estado real de cada agente según lo que está conectado (sin fingir integraciones).
export function agentsStatus(db, config) {
  const last = (action) => db.get("SELECT at FROM audit_log WHERE action LIKE ? ORDER BY id DESC LIMIT 1", action + "%")?.at || null;
  const waMode = config.whatsapp.apiConfigured ? "API oficial" : "semiautomático (enlace wa.me)";
  return [
    { id: "director", name: "Director general", status: "activo", detail: "Informe diario 08:00, prioridades y alertas.", lastRun: last("informe.diario") },
    { id: "pedidos", name: "Pedidos y proveedor", status: config.shopify.configured || config.demo ? "activo" : "falta conexión",
      detail: `Shopify ${config.shopify.configured ? "conectado" : config.demo ? "simulado (demo)" : "sin conectar"} · WhatsApp ${waMode}`, lastRun: last("pedido.") },
    { id: "finanzas", name: "Finanzas y rentabilidad", status: "activo (parcial)", detail: "Beneficio estimado por pedido. Faltan costes reales y gasto publicitario automático.", lastRun: last("informe.diario") },
    { id: "atencion", name: "Atención al cliente", status: "preparado, sin canal",
      detail: "Consulta de estado de pedido lista (API interna). Falta conectar Shopify Inbox / correo.", lastRun: null },
    { id: "catalogo", name: "Gestión de productos", status: "auditoría", detail: "Sincroniza variantes y costes desde Shopify. Cambios de ficha y precio: pendiente.", lastRun: last("catalogo.") },
    { id: "publicidad", name: "Publicidad y marketing", status: "sin conectar", detail: "Necesita Meta Ads / Google Ads / TikTok Ads. Nunca gastará sin tu aprobación.", lastRun: null },
    { id: "optimizacion", name: "Optimización de tienda", status: "manual", detail: "Auditorías bajo petición; cambios solo en temas sin publicar.", lastRun: null },
  ];
}
