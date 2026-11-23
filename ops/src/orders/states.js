// Estados internos del pedido y transiciones permitidas.
export const STATES = {
  nuevo: "Nuevo pedido",
  pendiente_consulta: "Pendiente de consultar al proveedor",
  disponibilidad_confirmada: "Disponibilidad confirmada",
  pendiente_autorizacion: "Pendiente de tu autorización",
  solicitado_proveedor: "Pedido solicitado al proveedor",
  confirmado_proveedor: "Confirmado por el proveedor",
  preparando_envio: "Preparando envío",
  enviado: "Enviado con seguimiento",
  entregado: "Entregado",
  incidencia: "Incidencia",
  cancelado: "Cancelado",
};

const T = {
  nuevo: ["pendiente_consulta", "pendiente_autorizacion", "solicitado_proveedor", "incidencia", "cancelado"],
  pendiente_consulta: ["disponibilidad_confirmada", "incidencia", "cancelado"],
  disponibilidad_confirmada: ["pendiente_autorizacion", "solicitado_proveedor", "incidencia", "cancelado"],
  pendiente_autorizacion: ["solicitado_proveedor", "incidencia", "cancelado"],
  solicitado_proveedor: ["confirmado_proveedor", "preparando_envio", "enviado", "incidencia", "cancelado"],
  confirmado_proveedor: ["preparando_envio", "enviado", "incidencia", "cancelado"],
  preparando_envio: ["enviado", "incidencia", "cancelado"],
  enviado: ["entregado", "incidencia"],
  entregado: ["incidencia"],
  // Desde incidencia puedes reanudar el flujo manualmente donde corresponda.
  incidencia: ["pendiente_consulta", "disponibilidad_confirmada", "pendiente_autorizacion", "solicitado_proveedor", "confirmado_proveedor", "preparando_envio", "enviado", "entregado", "cancelado"],
  cancelado: [],
};

export function canTransition(from, to) {
  return from === to || (T[from] || []).includes(to);
}

// Estados en los que el proveedor ya tiene el pedido (afecta a cancelaciones y seguimiento).
export const SUPPLIER_HAS_ORDER = ["solicitado_proveedor", "confirmado_proveedor", "preparando_envio", "enviado"];
