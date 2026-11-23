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
      if (it.supplier_ref || it.sku) lines.push(`Referencia: ${it.supplier_ref || it.sku}`);
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

export function buildPedidoMessage(order, items) {
  const addr = [
    order.ship_name,
    order.ship_address1,
    order.ship_address2,
    [order.ship_zip, order.ship_city].filter(Boolean).join(" "),
    order.ship_province,
    order.ship_country,
  ].filter(Boolean).join("\n");
  return [
    `Perfecto, confirmo el pedido ${order.name}.`,
    "",
    itemLines(items),
    "",
    "Datos de entrega:",
    addr,
    order.ship_phone ? `Teléfono de entrega: ${order.ship_phone}` : null,
    "",
    "Cuando salga, pásame el número de seguimiento y la empresa de transporte, por favor.",
  ].filter((l) => l !== null).join("\n");
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
