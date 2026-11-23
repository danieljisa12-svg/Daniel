// Base de datos SQLite (node:sqlite, sin dependencias). Un solo archivo en DATA_DIR.
// Todas las escrituras pasan por aquí; las tablas únicas evitan duplicados.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Webhooks ya recibidos (Shopify y WhatsApp): evita procesar dos veces el mismo evento.
CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  event_id TEXT NOT NULL,
  topic TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, event_id)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  whatsapp TEXT NOT NULL,              -- formato internacional sin "+", p. ej. 34600111222
  consent_at TEXT,                     -- cuándo aceptó recibir mensajes del sistema
  consent_note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Catálogo del proveedor: relación variante de Shopify -> referencia y coste del proveedor.
CREATE TABLE IF NOT EXISTS supplier_products (
  id INTEGER PRIMARY KEY,
  supplier_id INTEGER REFERENCES suppliers(id),
  shopify_variant_id TEXT,
  sku TEXT,
  title TEXT NOT NULL,
  variant_title TEXT,
  supplier_ref TEXT,
  unit_cost REAL,                      -- coste unitario acordado (EUR)
  shipping_cost REAL,                  -- envío que cobra el proveedor por pedido (EUR)
  auto_order INTEGER NOT NULL DEFAULT 0,   -- 1 = puede pedirse sin aprobación manual
  auto_max_amount REAL,                -- importe máximo por pedido para la compra automática
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(shopify_variant_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  shopify_order_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,                  -- "#1007"
  status TEXT NOT NULL,
  financial_status TEXT,
  currency TEXT NOT NULL DEFAULT 'EUR',
  total_price REAL NOT NULL DEFAULT 0,
  shipping_price REAL NOT NULL DEFAULT 0,
  supplier_id INTEGER REFERENCES suppliers(id),
  -- Datos personales mínimos para el envío. Se borran pasado PII_RETENTION_DAYS.
  customer_name TEXT,
  customer_email TEXT,
  ship_name TEXT, ship_address1 TEXT, ship_address2 TEXT, ship_zip TEXT,
  ship_city TEXT, ship_province TEXT, ship_country TEXT, ship_phone TEXT,
  pii_purged_at TEXT,
  is_test INTEGER NOT NULL DEFAULT 0,  -- pedido de prueba de Shopify
  -- Respuesta del proveedor
  supplier_available INTEGER,
  supplier_total_cost REAL,
  supplier_eta_days INTEGER,
  -- Seguimiento
  tracking_number TEXT,
  tracking_company TEXT,
  tracking_url TEXT,
  shopify_fulfillment_id TEXT,
  incident TEXT,
  created_at TEXT NOT NULL,            -- fecha del pedido en Shopify
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_supplier_contact_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shopify_line_item_id TEXT,
  shopify_variant_id TEXT,
  sku TEXT,
  title TEXT NOT NULL,
  variant_title TEXT,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  supplier_product_id INTEGER REFERENCES supplier_products(id)
);

-- Mensajes con el proveedor (enviados y recibidos), ligados al pedido.
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  supplier_id INTEGER REFERENCES suppliers(id),
  direction TEXT NOT NULL,             -- out | in
  kind TEXT NOT NULL,                  -- consulta | pedido | seguimiento | respuesta | otro
  channel TEXT NOT NULL,               -- whatsapp_api | whatsapp_manual
  body TEXT NOT NULL,
  status TEXT NOT NULL,                -- borrador | listo_para_enviar | enviado | entregado | leido | fallido | recibido
  wa_message_id TEXT,
  parsed_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  UNIQUE(order_id, kind, direction, wa_message_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_out_once2 ON messages(order_id, kind) WHERE direction = 'out' AND status != 'fallido' AND kind != 'seguimiento';

-- Centro de aprobaciones: nada económico o delicado se ejecuta sin una fila aprobada aquí.
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,                  -- compra_proveedor | seguimiento | incidencia | respuesta_ambigua
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  details_json TEXT NOT NULL,
  amount REAL,
  status TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente | aprobada | rechazada
  decided_at TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_approvals_pending_once ON approvals(type, order_id) WHERE status = 'pendiente';

-- Cola persistente de tareas con reintentos y clave anti-duplicados.
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  dedupe_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente | en_curso | hecho | fallido
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  run_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(status, run_at);

-- Registro de todas las acciones (solo se inserta, nunca se modifica).
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT NOT NULL,                 -- sistema | propietario | agente:<nombre>
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  result TEXT NOT NULL,                -- ok | error | bloqueado | omitido
  details_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  level TEXT NOT NULL,                 -- info | aviso | error
  title TEXT NOT NULL,
  body TEXT,
  order_id INTEGER,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Gasto publicitario diario (manual hasta conectar Meta/Google/TikTok).
CREATE TABLE IF NOT EXISTS ad_spend (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,
  platform TEXT NOT NULL,
  amount REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  UNIQUE(day, platform)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,                  -- diario
  period TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(kind, period)
);
`;

export function openDb(dataDir, file = "ops.db") {
  let target = ":memory:";
  if (dataDir !== ":memory:") {
    fs.mkdirSync(dataDir, { recursive: true });
    target = path.join(dataDir, file);
  }
  const db = new DatabaseSync(target);
  db.exec(SCHEMA);
  migrate(db);
  return wrap(db);
}

// Migraciones sencillas para bases de datos creadas con versiones anteriores.
function migrate(db) {
  const cols = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
  if (!cols.includes("is_test")) db.exec("ALTER TABLE orders ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0");
  db.exec("DROP INDEX IF EXISTS idx_messages_out_once");
}

function wrap(db) {
  const stmts = new Map();
  const prep = (sql) => {
    let s = stmts.get(sql);
    if (!s) { s = db.prepare(sql); stmts.set(sql, s); }
    return s;
  };
  let depth = 0;
  const api = {
    raw: db,
    get: (sql, ...p) => prep(sql).get(...p),
    all: (sql, ...p) => prep(sql).all(...p),
    run: (sql, ...p) => prep(sql).run(...p),
    exec: (sql) => db.exec(sql),
    // Transacción anidable (usa SAVEPOINT dentro de otra transacción).
    tx(fn) {
      const sp = `sp${depth}`;
      db.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${sp}`);
      depth++;
      try {
        const r = fn();
        depth--;
        db.exec(depth === 0 ? "COMMIT" : `RELEASE ${sp}`);
        return r;
      } catch (e) {
        depth--;
        db.exec(depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw e;
      }
    },
    setting(key, fallback = null) {
      const r = prep("SELECT value FROM settings WHERE key = ?").get(key);
      return r ? JSON.parse(r.value) : fallback;
    },
    setSetting(key, value) {
      prep("INSERT INTO settings(key, value, updated_at) VALUES(?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
        .run(key, JSON.stringify(value));
    },
    close: () => db.close(),
  };
  return api;
}
