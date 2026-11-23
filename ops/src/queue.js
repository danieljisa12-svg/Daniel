// Cola persistente de tareas: sobrevive a reinicios, reintenta con espera creciente
// y no duplica tareas gracias a dedupe_key.
import { audit } from "./audit.js";

export function createQueue(db, { alert, onPausedTypes = new Set() } = {}) {
  const handlers = new Map();
  let timer = null;
  let running = false;

  function enqueue(type, payload = {}, { dedupeKey = null, delaySec = 0, maxAttempts = 5 } = {}) {
    const r = db.run(
      `INSERT INTO jobs(type, payload_json, dedupe_key, run_at, max_attempts)
       VALUES(?, ?, ?, datetime('now', ?), ?) ON CONFLICT(dedupe_key) DO NOTHING`,
      type, JSON.stringify(payload), dedupeKey, `+${Math.max(0, Math.floor(delaySec))} seconds`, maxAttempts
    );
    return r.changes > 0;
  }

  async function runDue(limit = 20) {
    if (running) return 0;
    running = true;
    let done = 0;
    try {
      const paused = db.setting("automation_paused", false);
      const due = db.all(
        "SELECT * FROM jobs WHERE status = 'pendiente' AND run_at <= datetime('now') ORDER BY run_at, id LIMIT ?", limit
      );
      for (const job of due) {
        if (paused && onPausedTypes.has(job.type)) {
          db.run("UPDATE jobs SET run_at = datetime('now', '+5 minutes'), updated_at = datetime('now') WHERE id = ?", job.id);
          continue;
        }
        const h = handlers.get(job.type);
        if (!h) {
          db.run("UPDATE jobs SET status='fallido', last_error='Sin manejador', updated_at=datetime('now') WHERE id=?", job.id);
          continue;
        }
        // Reclamar la tarea (evita que dos procesos la ejecuten a la vez).
        const claim = db.run("UPDATE jobs SET status='en_curso', attempts = attempts + 1, updated_at=datetime('now') WHERE id=? AND status='pendiente'", job.id);
        if (!claim.changes) continue;
        try {
          await h(JSON.parse(job.payload_json), job);
          db.run("UPDATE jobs SET status='hecho', last_error=NULL, updated_at=datetime('now') WHERE id=?", job.id);
          done++;
        } catch (e) {
          const attempts = job.attempts + 1;
          const msg = String(e?.message || e).slice(0, 500);
          if (attempts >= job.max_attempts || e?.permanent) {
            db.run("UPDATE jobs SET status='fallido', last_error=?, updated_at=datetime('now') WHERE id=?", msg, job.id);
            audit(db, { action: `tarea.${job.type}`, entity: "job", entityId: job.id, result: "error", details: { error: msg, attempts } });
            await alert?.("error", `Tarea fallida: ${job.type}`, msg);
          } else {
            const wait = 60 * 5 ** (attempts - 1); // 1 min, 5 min, 25 min, ~2 h
            db.run("UPDATE jobs SET status='pendiente', last_error=?, run_at=datetime('now', ?), updated_at=datetime('now') WHERE id=?",
              msg, `+${wait} seconds`, job.id);
          }
        }
      }
    } finally {
      running = false;
    }
    return done;
  }

  // Tareas que quedaron "en_curso" por un reinicio vuelven a la cola.
  function recover() {
    db.run("UPDATE jobs SET status='pendiente', updated_at=datetime('now') WHERE status='en_curso' AND updated_at < datetime('now', '-10 minutes')");
  }

  return {
    enqueue,
    runDue,
    recover,
    register: (type, fn) => handlers.set(type, fn),
    start(intervalMs = 5000) {
      recover();
      timer = setInterval(() => runDue().catch(() => {}), intervalMs);
      timer.unref?.();
    },
    stop: () => timer && clearInterval(timer),
  };
}
