// Correos de estado del pedido + envío con Resend (https://resend.com) si hay EMAIL_API_KEY; si no, "Simulado".
// Los correos siempre quedan registrados en la tabla correos_pedido.
const ASUNTOS = {
  Pagado:    { asunto: 'Recibimos tu pago', mensaje: 'Tu pago fue confirmado y ya estamos preparando tu pedido.' },
  Enviado:   { asunto: 'Tu pedido va en camino', mensaje: 'Tu pedido salió de nuestra bodega y va en camino a tu domicilio.' },
  Entregado: { asunto: 'Tu pedido fue entregado', mensaje: 'Tu pedido fue entregado. ¡Gracias por comprar con nosotros!' },
  Cancelado: { asunto: 'Tu pedido fue cancelado', mensaje: 'Tu pedido fue cancelado. Si tienes dudas, respóndenos este correo.' }
};
export const ESTADOS_VALIDOS = [...Object.keys(ASUNTOS), 'Pendiente'];

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
const mxn = n => '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 }) + ' MXN';

// `p` = fila de pedidos (snake_case); `items` = filas de detalle_pedido
export function construirCorreo(p, items) {
  const base = ASUNTOS[p.estado] || { asunto: `Estado de tu pedido: ${p.estado}`, mensaje: `El estado de tu pedido ahora es "${p.estado}".` };
  const asunto = `Pedido ${p.folio}: ${base.asunto}`;
  const envio = Number(p.costo_envio) ? mxn(p.costo_envio) : 'Gratis';
  const texto = [
    `Hola ${p.cliente_nombre},`, '', base.mensaje, '',
    `Folio: ${p.folio}`, `Estado: ${p.estado}`, '',
    ...items.map(i => `${i.cantidad} x ${i.producto} (${i.color}) - ${mxn(i.precio_unitario * i.cantidad)}`), '',
    `Subtotal: ${mxn(p.subtotal)}`, `Envío: ${envio}`, `Total: ${mxn(p.total)}`, '',
    `Entrega: ${p.direccion} (C.P. ${p.codigo_postal}, ${p.estado_envio})`, '',
    'LocalStorage'
  ].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#222">
  <h2 style="margin-bottom:4px">LocalStorage</h2>
  <p>Hola ${esc(p.cliente_nombre)},</p>
  <p>${esc(base.mensaje)}</p>
  <p style="font-size:18px"><strong>${esc(p.folio)}</strong> · <span style="background:#e8f3ec;padding:2px 8px;border-radius:4px">${esc(p.estado)}</span></p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    ${items.map(i => `<tr><td style="padding:4px 0">${i.cantidad} × ${esc(i.producto)} (${esc(i.color)})</td><td style="text-align:right">${mxn(i.precio_unitario * i.cantidad)}</td></tr>`).join('')}
    <tr><td style="padding-top:8px;border-top:1px solid #ddd">Envío</td><td style="text-align:right;border-top:1px solid #ddd;padding-top:8px">${envio}</td></tr>
    <tr><td><strong>Total</strong></td><td style="text-align:right"><strong>${mxn(p.total)}</strong></td></tr>
  </table>
  <p style="font-size:13px;color:#555">Entrega en: ${esc(p.direccion)} (C.P. ${esc(p.codigo_postal)}, ${esc(p.estado_envio)})</p>
</div>`;
  return { asunto, texto, html };
}

// Nunca lanza: devuelve { resultado: 'Enviado' | 'Simulado' | 'Error', detalle }
export async function enviarCorreo(env, { para, asunto, texto, html }) {
  if (!env.EMAIL_API_KEY || !env.EMAIL_FROM) {
    return { resultado: 'Simulado', detalle: 'Sin proveedor de correo configurado (EMAIL_API_KEY / EMAIL_FROM).' };
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${env.EMAIL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [para], subject: asunto, text: texto, html })
    });
    if (!r.ok) return { resultado: 'Error', detalle: `Resend ${r.status}: ${(await r.text()).slice(0, 250)}` };
    return { resultado: 'Enviado', detalle: 'Aceptado por Resend' };
  } catch (e) {
    return { resultado: 'Error', detalle: String(e.message || e).slice(0, 250) };
  }
}
