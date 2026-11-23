// Firmas y comparaciones seguras.
import crypto from "node:crypto";

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ""));
  const bb = Buffer.from(String(b ?? ""));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Shopify: X-Shopify-Hmac-Sha256 = base64(HMAC-SHA256(cuerpo crudo, client secret))
export function verifyShopifyHmac(rawBody, headerHmac, secret) {
  if (!secret || !headerHmac) return false;
  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  return safeEqual(digest, headerHmac);
}

// Meta/WhatsApp: X-Hub-Signature-256 = "sha256=" + hex(HMAC-SHA256(cuerpo crudo, app secret))
export function verifyMetaSignature(rawBody, header, appSecret) {
  if (!appSecret || !header) return false;
  const digest = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return safeEqual(digest, header);
}

// Sesión del panel: token firmado "expira.firma"
export function signSession(secret, ttlMs = 1000 * 60 * 60 * 12) {
  const exp = String(Date.now() + ttlMs);
  const sig = crypto.createHmac("sha256", secret).update("panel." + exp).digest("hex");
  return exp + "." + sig;
}
export function verifySession(secret, token) {
  if (!secret || !token) return false;
  const [exp, sig] = String(token).split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const want = crypto.createHmac("sha256", secret).update("panel." + exp).digest("hex");
  return safeEqual(sig, want);
}

export const randomId = () => crypto.randomBytes(12).toString("hex");
