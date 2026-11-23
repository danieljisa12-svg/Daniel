// Registro de acciones (auditoría) y alertas. Nunca se guardan datos personales en los detalles.
export function audit(db, { actor = "sistema", action, entity = null, entityId = null, result = "ok", details = null }) {
  db.run(
    "INSERT INTO audit_log(actor, action, entity, entity_id, result, details_json) VALUES(?,?,?,?,?,?)",
    actor, action, entity, entityId == null ? null : String(entityId), result, details ? JSON.stringify(details) : null
  );
}

export function createAlerter(db, config, fetchImpl = globalThis.fetch) {
  return async function alert(level, title, body = "", orderId = null) {
    db.run("INSERT INTO alerts(level, title, body, order_id) VALUES(?,?,?,?)", level, title, body, orderId);
    // Aviso al móvil con ntfy: solo texto genérico, sin nombres ni direcciones de clientes.
    if (!config.alerts.ntfyTopic || config.demo) return;
    try {
      // Publicación JSON de ntfy (admite acentos en título y mensaje).
      await fetchImpl(config.alerts.ntfyServer + "/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: config.alerts.ntfyTopic,
          title,
          message: body || title,
          priority: level === "error" ? 4 : 3,
          tags: [level === "error" ? "warning" : "package"],
          click: config.publicUrl + "/panel",
        }),
      });
    } catch (e) {
      audit(db, { action: "alerta.ntfy", result: "error", details: { error: String(e.message || e) } });
    }
  };
}
