// Monta todas las piezas. Se usa en el servidor y en las pruebas (con dobles de Shopify/WhatsApp).
import path from "node:path";
import fs from "node:fs";
import { openDb } from "./db.js";
import { createAlerter, audit } from "./audit.js";
import { createQueue } from "./queue.js";
import { createShopifyClient } from "./shopify/client.js";
import { createWhatsAppClient } from "./whatsapp/cloud.js";
import { createOrderService, DEFAULT_SETTINGS } from "./orders/service.js";
import { runDailyReport, localDate } from "./director.js";
import { bootstrap } from "./setup.js";
import { syncCatalog } from "./shopify/catalog.js";

export function createApp(config, { db = null, fetchImpl = globalThis.fetch, shopify = null, whatsapp = null } = {}) {
  db = db || openDb(config.dataDir);
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) if (db.setting(k) === null) db.setSetting(k, v);

  const alert = createAlerter(db, config, fetchImpl);
  // Tareas que actúan hacia fuera: se detienen con el botón de pausa.
  const queue = createQueue(db, { alert, onPausedTypes: new Set(["message.send", "shopify.fulfill", "order.process"]) });
  shopify = shopify || (config.shopify.configured ? createShopifyClient(config, fetchImpl) : null);
  whatsapp = whatsapp || (config.whatsapp.apiConfigured ? createWhatsAppClient(config, fetchImpl) : null);
  const orders = createOrderService({ db, config, shopify, whatsapp, queue, alert, fetchImpl });
  // Mensajes entrantes de WhatsApp: se procesan en la cola para responder a Meta al instante.
  queue.register("whatsapp.incoming", (m) => orders.receiveSupplierMessage({ ...m, channel: "whatsapp_api" }));

  // Planificador interno (el servicio corre 24/7 en la nube, no depende de tu ordenador).
  const timers = [];
  function startScheduler() {
    queue.start(5000);
    // Al arrancar: registra los webhooks que falten y sincroniza el catálogo (si Shopify está conectado).
    bootstrap(app).catch((e) => audit(db, { action: "arranque", result: "error", details: { error: e.message } }));
    const every = (ms, fn) => { const t = setInterval(() => fn().catch((e) => audit(db, { action: "programador", result: "error", details: { error: e.message } })), ms); t.unref?.(); timers.push(t); };
    every(15 * 60 * 1000, () => orders.watchdog());
    every(60 * 1000, async () => {
      const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: config.timezone, hour: "2-digit", hour12: false }).format(new Date()));
      const today = localDate(config.timezone);
      if (hour >= 8 && db.setting("last_daily_report") !== today) {
        db.setSetting("last_daily_report", today);
        await runDailyReport(db, config, alert);
      }
      if (hour >= 3 && db.setting("last_maintenance") !== today) {
        db.setSetting("last_maintenance", today);
        orders.purgePii();
        backup(db, config);
        if (shopify && !config.demo) await syncCatalog(db, shopify).catch((e) => alert("aviso", "Sincronización de catálogo fallida", e.message));
      }
    });
  }

  const app = {
    config, db, queue, orders, alert, shopify, whatsapp, startScheduler,
    stop() { queue.stop(); timers.forEach(clearInterval); },
  };
  return app;
}

// Copia de seguridad diaria de la base de datos (se conservan 14).
export function backup(db, config) {
  if (config.dataDir === ":memory:") return null;
  const dir = path.join(config.dataDir, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `ops-${new Date().toISOString().slice(0, 10)}.db`);
  if (!fs.existsSync(file)) db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const all = fs.readdirSync(dir).filter((f) => f.startsWith("ops-")).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 14))) fs.unlinkSync(path.join(dir, old));
  audit(db, { action: "copia_seguridad", details: { file: path.basename(file) } });
  return file;
}
