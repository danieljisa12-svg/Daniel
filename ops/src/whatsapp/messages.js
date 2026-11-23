// Redacción de mensajes al proveedor. Dos fases para proteger los datos del cliente:
//  1) "consulta": solo producto, variante y cantidad (sin datos personales).
//  2) "pedido": se añade la dirección de entrega SOLO cuando tú has aprobado la compra
//     (o existe una regla de compra automática autorizada).

function itemLines(items) {
  return items
    .map((it) => {
      const lines = [`Producto: ${it.title}`];
      if (it.variant_title) lines.push(`Variante: ${it.variant_title}`);
      lines.push(`Cantidad: ${it.quantity}`);
      if (it.supplier_ref || it.sku) lines.push(`Ref. producto: ${it.supplier_ref || it.sku}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

export function buildConsultaMessage(order, items) {
  return [
    "Buenas, tengo un pedido nuevo.",
    "",
    `Referencia: ${order.name}`,
    "",
    itemLines(items),
    "",
    "¿Me confirmas disponibilidad, precio final (con envío) y plazo de envío?",
    `Responde indicando la referencia ${order.name}, por favor. ¡Gracias!`,
  ].join("\n");
}

export function shippingBlock(order) {
  return [
    order.ship_name,
    order.ship_address1,
    order.ship_address2,
    [order.ship_zip, order.ship_city].filter(Boolean).join(" "),
    order.ship_province,
    order.ship_country,
  ].filter(Boolean).join("\n") + (order.ship_phone ? `\nTeléfono: ${order.ship_phone}` : "");
}

// Modo "consulta": tras confirmar disponibilidad.
export function buildPedidoMessage(order, items) {
  return [
    `Perfecto, confirmo el pedido ${order.name}.`,
    "",
    itemLines(items),
    "",
    "Datos de envío:",
    shippingBlock(order),
    "",
    "Cuando salga, pásame el número de seguimiento y la empresa de transporte, por favor.",
  ].join("\n");
}

// Modo "directo" (por defecto): el proveedor tiene el stock y envía. Un solo mensaje con todo.
export function buildPedidoDirectoMessage(order, items) {
  return [
    "Buenas, tengo un pedido nuevo para enviar.",
    "",
    `Referencia: ${order.name}`,
    "",
    itemLines(items),
    "",
    "Datos de envío:",
    shippingBlock(order),
    "",
    "Cuando salga, pásame el número de seguimiento y la empresa de transporte, por favor. ¡Gracias!",
  ].join("\n");
}

// Una línea para las plantillas de WhatsApp (no admiten saltos de línea).
export function itemsOneLine(items) {
  return items.map((i) => `${i.title}${i.variant_title ? " (" + i.variant_title + ")" : ""} x${i.quantity}${i.supplier_ref || i.sku ? " ref " + (i.supplier_ref || i.sku) : ""}`).join("; ");
}

export function buildSeguimientoMessage(order) {
  return [
    `Hola, ¿cómo va el pedido ${order.name}?`,
    "¿Me puedes pasar el número de seguimiento y la empresa de transporte cuando lo tengas?",
  ].join("\n");
}

// Enlace "click to chat" oficial de WhatsApp (modo semiautomático: tú pulsas enviar).
export function waLink(phone, text) {
  const digits = String(phone).replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
