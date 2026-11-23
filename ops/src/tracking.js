// Validación de números de seguimiento. Nunca se inventa un número: solo se aceptan
// cadenas que aparecen literalmente en el mensaje del proveedor y tienen un formato reconocible.

// UPU S10 (Correos, China Post, etc.): 2 letras + 8 dígitos + dígito de control + 2 letras (país).
export function isValidS10(code) {
  const m = /^([A-Z]{2})(\d{8})(\d)([A-Z]{2})$/.exec(code);
  if (!m) return false;
  const w = [8, 6, 4, 2, 3, 5, 9, 7];
  const sum = m[2].split("").reduce((a, d, i) => a + Number(d) * w[i], 0);
  let check = 11 - (sum % 11);
  if (check === 10) check = 0;
  if (check === 11) check = 5;
  return check === Number(m[3]);
}

const CARRIER_NAMES = [
  ["correos express", "Correos Express"], ["correos", "Correos"], ["seur", "SEUR"], ["gls", "GLS"],
  ["mrw", "MRW"], ["nacex", "Nacex"], ["dhl", "DHL"], ["ups", "UPS"], ["fedex", "FedEx"], ["tnt", "TNT"],
  ["ctt", "CTT"], ["yunexpress", "YunExpress"], ["cainiao", "Cainiao"], ["4px", "4PX"], ["yanwen", "Yanwen"],
  ["inpost", "InPost"], ["zeleris", "Zeleris"], ["envialia", "Envialia"], ["sending", "Sending"],
];

export function detectCarrierName(text) {
  const t = String(text || "").toLowerCase();
  for (const [needle, name] of CARRIER_NAMES) if (new RegExp(`\\b${needle}\\b`).test(t)) return name;
  return null;
}

// Devuelve { number, carrier, confidence } o null.
export function classifyTracking(raw, statedCarrier = null) {
  const code = String(raw || "").toUpperCase().replace(/[\s-]/g, "");
  if (code.length < 8 || code.length > 30 || !/^[A-Z0-9]+$/.test(code) || !/\d{5,}/.test(code)) return null;
  if (isValidS10(code)) return { number: code, carrier: statedCarrier || (code.endsWith("ES") ? "Correos" : null), confidence: 0.95 };
  if (/^1Z[0-9A-Z]{16}$/.test(code)) return { number: code, carrier: "UPS", confidence: 0.95 };
  if (/^YT\d{16}$/.test(code)) return { number: code, carrier: "YunExpress", confidence: 0.9 };
  if (/^PQ[0-9A-Z]{21}$/.test(code)) return { number: code, carrier: "Correos", confidence: 0.85 };
  if (/^(LP|CNES|CNG)\d{10,20}$/.test(code)) return { number: code, carrier: statedCarrier || "Cainiao", confidence: 0.8 };
  if (/^\d{10,22}$/.test(code)) return { number: code, carrier: statedCarrier, confidence: statedCarrier ? 0.75 : 0.55 };
  if (/^[A-Z]{2,4}\d{8,20}[A-Z]{0,3}$/.test(code)) return { number: code, carrier: statedCarrier, confidence: statedCarrier ? 0.7 : 0.5 };
  return null;
}

// Busca candidatos a número de seguimiento en un texto libre.
export function findTrackingCandidates(text) {
  const carrier = detectCarrierName(text);
  const tokens = String(text || "").match(/[A-Za-z0-9][A-Za-z0-9 -]{6,34}[A-Za-z0-9]/g) || [];
  const seen = new Set();
  const out = [];
  for (const tok of tokens) {
    // Probar el token completo y también cada palabra por separado.
    for (const piece of [tok, ...tok.split(/\s+/)]) {
      const c = classifyTracking(piece, carrier);
      if (c && !seen.has(c.number)) { seen.add(c.number); out.push(c); }
    }
  }
  // Prioriza los de mayor confianza y descarta los que son parte de otro.
  out.sort((a, b) => b.confidence - a.confidence || b.number.length - a.number.length);
  return out.filter((c, i) => !out.slice(0, i).some((o) => o.number.includes(c.number)));
}

const TRACK_URLS = {
  Correos: (n) => `https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number=${n}`,
  UPS: (n) => `https://www.ups.com/track?tracknum=${n}`,
  YunExpress: (n) => `https://www.yuntrack.com/parcelTracking?id=${n}`,
  DHL: (n) => `https://www.dhl.com/es-es/home/seguimiento.html?tracking-id=${n}`,
  SEUR: (n) => `https://www.seur.com/livetracking/?segOnlineIdentificador=${n}`,
  GLS: (n) => `https://gls-group.com/ES/es/seguimiento-envio?match=${n}`,
};
export function trackingUrl(carrier, number) {
  const f = TRACK_URLS[carrier];
  return f ? f(number) : `https://parcelsapp.com/es/tracking/${number}`;
}
