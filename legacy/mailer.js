// Correos de estado del pedido.
// En local (Node) los correos se SIMULAN: se guardan en la tabla CorreosPedido y se ven en el panel admin.
// En producción (Hostgator) el backend PHP envía el correo real con mail().
const ASUNTOS = {
  Pagado:    { asunto: 'Recibimos tu pago', mensaje: 'Tu pago fue confirmado y ya estamos preparando tu pedido.' },
  Enviado:   { asunto: 'Tu pedido va en camino', mensaje: 'Tu pedido salió de nuestra bodega y va en camino a tu domicilio.' },
  Entregado: { asunto: 'Tu pedido fue entregado', mensaje: 'Tu pedido fue entregado. ¡Gracias por comprar con nosotros!' },
  Cancelado: { asunto: 'Tu pedido fue cancelado', mensaje: 'Tu pedido fue cancelado. Si tienes dudas, respóndenos este correo.' }
};

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
const mxn = n => '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 }) + ' MXN';

function construirCorreo(pedido, items) {
  const base = ASUNTOS[pedido.Estado] || { asunto: `Estado de tu pedido: ${pedido.Estado}`, mensaje: `El estado de tu pedido ahora es "${pedido.Estado}".` };
  const asunto = `Pedido ${pedido.Folio}: ${base.asunto}`;
  const lineas = items.map(i => `${i.Cantidad} x ${i.Producto} (${i.Color}) - ${mxn(i.PrecioUnitario * i.Cantidad)}`);

  const texto = [
    `Hola ${pedido.ClienteNombre},`, '', base.mensaje, '',
    `Folio: ${pedido.Folio}`, `Estado: ${pedido.Estado}`, '',
    ...lineas, '',
    `Subtotal: ${mxn(pedido.Subtotal)}`, `Envío: ${Number(pedido.CostoEnvio) ? mxn(pedido.CostoEnvio) : 'Gratis'}`, `Total: ${mxn(pedido.Total)}`, '',
    `Entrega: ${pedido.Direccion} (C.P. ${pedido.CodigoPostal}, ${pedido.EstadoEnvio})`, '',
    'LocalStorage'
  ].join('\n');

  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#222">
  <h2 style="margin-bottom:4px">LocalStorage</h2>
  <p>Hola ${esc(pedido.ClienteNombre)},</p>
  <p>${esc(base.mensaje)}</p>
  <p style="font-size:18px"><strong>${esc(pedido.Folio)}</strong> · <span style="background:#e8f3ec;padding:2px 8px;border-radius:4px">${esc(pedido.Estado)}</span></p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    ${items.map(i => `<tr><td style="padding:4px 0">${i.Cantidad} × ${esc(i.Producto)} (${esc(i.Color)})</td><td style="text-align:right">${mxn(i.PrecioUnitario * i.Cantidad)}</td></tr>`).join('')}
    <tr><td style="padding-top:8px;border-top:1px solid #ddd">Envío</td><td style="text-align:right;border-top:1px solid #ddd;padding-top:8px">${Number(pedido.CostoEnvio) ? mxn(pedido.CostoEnvio) : 'Gratis'}</td></tr>
    <tr><td><strong>Total</strong></td><td style="text-align:right"><strong>${mxn(pedido.Total)}</strong></td></tr>
  </table>
  <p style="font-size:13px;color:#555">Entrega en: ${esc(pedido.Direccion)} (C.P. ${esc(pedido.CodigoPostal)}, ${esc(pedido.EstadoEnvio)})</p>
</div>`;
  return { asunto, texto, html };
}

module.exports = { construirCorreo, ESTADOS_VALIDOS: Object.keys(ASUNTOS).concat('Pendiente') };
