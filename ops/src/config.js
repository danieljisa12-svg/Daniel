// Configuración leída de variables de entorno. Los secretos nunca van en el código.
import fs from "node:fs";
import path from "node:path";

// Carga opcional de .env en local (sin dependencias). En la nube se usan variables del proveedor.
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadDotEnv(path.resolve(process.cwd(), ".env"));

const env = (k, d = "") => (process.env[k] ?? d).trim();
const num = (k, d) => {
  const v = Number(env(k, String(d)));
  return Number.isFinite(v) ? v : d;
};

export function loadConfig(overrides = {}) {
  const c = {
    port: num("PORT", 8080),
    publicUrl: env("PUBLIC_URL", "http://localhost:8080").replace(/\/$/, ""),
    dataDir: env("DATA_DIR", "./data"),
    timezone: env("TIMEZONE", "Europe/Madrid"),
    demo: env("DEMO_MODE", "0") === "1",

    panelPassword: env("PANEL_PASSWORD"),
    sessionSecret: env("SESSION_SECRET"),

    shopify: {
      shop: env("SHOPIFY_SHOP"),
      clientId: env("SHOPIFY_CLIENT_ID"),
      clientSecret: env("SHOPIFY_CLIENT_SECRET"),
      apiVersion: env("SHOPIFY_API_VERSION", "2026-10"),
    },
    whatsapp: {
      token: env("WHATSAPP_TOKEN"),
      phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID"),
      appSecret: env("WHATSAPP_APP_SECRET"),
      verifyToken: env("WHATSAPP_VERIFY_TOKEN"),
      graphVersion: env("WHATSAPP_GRAPH_VERSION", "v23.0"),
      templateConsulta: env("WHATSAPP_TEMPLATE_CONSULTA", "consulta_pedido_proveedor"),
      templatePedido: env("WHATSAPP_TEMPLATE_PEDIDO", "pedido_nuevo_proveedor"),
      templateLang: env("WHATSAPP_TEMPLATE_LANG", "es"),
    },
    claude: {
      apiKey: env("ANTHROPIC_API_KEY"),
      model: env("CLAUDE_MODEL", "claude-haiku-5-5"),
    },
    alerts: {
      ntfyTopic: env("NTFY_TOPIC"),
      ntfyServer: env("NTFY_SERVER", "https://ntfy.sh").replace(/\/$/, ""),
    },
    finance: {
      paymentFeePercent: num("PAYMENT_FEE_PERCENT", 2.1),
      paymentFeeFixed: num("PAYMENT_FEE_FIXED", 0.25),
    },
    piiRetentionDays: num("PII_RETENTION_DAYS", 90),
    ...overrides,
  };

  c.shopify.configured = !!(c.shopify.shop && c.shopify.clientId && c.shopify.clientSecret);
  c.whatsapp.apiConfigured = !!(c.whatsapp.token && c.whatsapp.phoneNumberId && c.whatsapp.appSecret);
  c.claude.configured = !!c.claude.apiKey;
  return c;
}

// Comprobaciones de arranque: en producción no se arranca con un panel sin proteger.
export function validateConfig(c) {
  const problems = [];
  if (!c.demo) {
    if (!c.panelPassword || c.panelPassword.length < 12) problems.push("PANEL_PASSWORD debe tener al menos 12 caracteres");
    if (!c.sessionSecret || c.sessionSecret.length < 32) problems.push("SESSION_SECRET debe tener al menos 32 caracteres (openssl rand -hex 32)");
    if (!c.shopify.clientSecret) problems.push("Falta SHOPIFY_CLIENT_SECRET: sin él no se pueden validar los webhooks de Shopify");
  }
  return problems;
}
