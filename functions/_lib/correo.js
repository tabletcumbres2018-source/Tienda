// Correos de los pedidos: confirmación de compra (al pagar) y avisos de cambio de estado.
// Proveedores soportados (se usa el primero que esté configurado en Cloudflare → Variables and Secrets):
//   1) Brevo  (https://www.brevo.com) → BREVO_API_KEY. No necesita dominio propio: basta con verificar el correo remitente.
//   2) Resend (https://resend.com)    → EMAIL_API_KEY. Para enviar a cualquier cliente necesita un dominio verificado.
// En ambos casos EMAIL_FROM es el remitente, por ejemplo:  LocalStorage <tucorreo@gmail.com>
// Si no hay proveedor, el correo queda "Simulado". Todos los correos se registran en la tabla correos_pedido.
const ASUNTOS = {
  Pagado:    { asunto: 'Confirmación de compra', mensaje: '¡Gracias por tu compra! Tu pago fue aprobado y ya estamos preparando tu pedido. Este correo es tu comprobante.' },
  Enviado:   { asunto: 'Tu pedido va en camino', mensaje: 'Tu pedido salió de nuestra bodega y va en camino a tu domicilio.' },
  Entregado: { asunto: 'Tu pedido fue entregado', mensaje: 'Tu pedido fue entregado. ¡Gracias por comprar con nosotros!' },
  Cancelado: { asunto: 'Tu pedido fue cancelado', mensaje: 'Tu pedido fue cancelado. Si tienes dudas, respóndenos este correo.' }
};
export const ESTADOS_VALIDOS = [...Object.keys(ASUNTOS), 'Pendiente'];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
const mxn = n => '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MXN';
const fechaMx = f => new Date(f).toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'long', timeStyle: 'short' });

// `p` = fila de pedidos (snake_case); `items` = filas de detalle_pedido
export function construirCorreo(p, items) {
  const base = ASUNTOS[p.estado] || { asunto: `Estado de tu pedido: ${p.estado}`, mensaje: `El estado de tu pedido ahora es "${p.estado}".` };
  const esConfirmacion = p.estado === 'Pagado';
  const asunto = `${base.asunto} · Pedido ${p.folio}`;
  const envio = Number(p.costo_envio) ? mxn(p.costo_envio) : 'Gratis';
  const pago = [p.metodo_pago, p.tarjeta_ultimos4 ? `terminación ${p.tarjeta_ultimos4}` : ''].filter(Boolean).join(' · ');
  const datosPago = esConfirmacion ? [
    ['Fecha de compra', fechaMx(p.creado_en)],
    ['Método de pago', pago || '—'],
    ['Referencia de pago', p.pago_referencia || '—']
  ] : [];

  const texto = [
    `Hola ${p.cliente_nombre},`, '', base.mensaje, '',
    `Folio: ${p.folio}`, `Estado: ${p.estado}`, ...datosPago.map(([k, v]) => `${k}: ${v}`), '',
    ...items.map(i => `${i.cantidad} x ${i.producto} (${i.color}) - ${mxn(i.precio_unitario * i.cantidad)}`), '',
    `Subtotal: ${mxn(p.subtotal)}`, `Envío: ${envio}`, `Total${esConfirmacion ? ' pagado' : ''}: ${mxn(p.total)}`, '',
    `Entrega: ${p.direccion} (C.P. ${p.codigo_postal}, ${p.estado_envio})`, '',
    'LocalStorage'
  ].join('\n');

  const fila = (k, v, fuerte) => `<tr><td style="padding:4px 0;color:#6b5644">${esc(k)}</td><td style="padding:4px 0;text-align:right">${fuerte ? `<strong>${v}</strong>` : v}</td></tr>`;
  const html = `<div style="background:#f5efe3;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#3b2a1e">
  <div style="max-width:560px;margin:auto;background:#fffaf0;border:1px solid #e6dac0;border-radius:10px;overflow:hidden">
    <div style="background:#3b2a1e;color:#fff;padding:16px 22px;font-size:20px;font-weight:bold">🛒 LocalStorage</div>
    <div style="padding:22px">
      ${esConfirmacion ? '<p style="font-size:22px;margin:0 0 8px;color:#2e6b3c"><strong>✅ Compra confirmada</strong></p>' : ''}
      <p style="margin:0 0 10px">Hola ${esc(p.cliente_nombre)},</p>
      <p style="margin:0 0 16px">${esc(base.mensaje)}</p>
      <p style="font-size:18px;margin:0 0 14px"><strong>${esc(p.folio)}</strong> · <span style="background:#e8f3ec;color:#2e6b3c;padding:2px 8px;border-radius:4px;font-size:14px">${esc(p.estado)}</span></p>
      ${datosPago.length ? `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:14px">${datosPago.map(([k, v]) => fila(k, esc(v))).join('')}</table>` : ''}
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${items.map(i => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee3cc">${i.cantidad} × ${esc(i.producto)} <span style="color:#8a7763">(${esc(i.color)})</span></td><td style="text-align:right;border-bottom:1px solid #eee3cc">${mxn(i.precio_unitario * i.cantidad)}</td></tr>`).join('')}
        ${fila('Subtotal', mxn(p.subtotal))}
        ${fila('Envío', envio)}
        ${fila(esConfirmacion ? 'Total pagado' : 'Total', mxn(p.total), true)}
      </table>
      <p style="font-size:13px;color:#6b5644;margin:16px 0 0">Entrega en: ${esc(p.direccion)} (C.P. ${esc(p.codigo_postal)}, ${esc(p.estado_envio)})</p>
    </div>
  </div>
  <p style="text-align:center;font-size:12px;color:#8a7763">Recibiste este correo porque realizaste una compra con esta cuenta en LocalStorage.</p>
</div>`;
  return { asunto, texto, html };
}

// "Nombre <correo@x.com>" → { name, email }
function remitente(valor) {
  const m = /^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/.exec(valor || '');
  return m ? { name: m[1] || 'LocalStorage', email: m[2] } : { name: 'LocalStorage', email: String(valor || '').trim() };
}

// Nunca lanza: devuelve { resultado: 'Enviado' | 'Simulado' | 'Error', detalle }
export async function enviarCorreo(env, { para, asunto, texto, html }) {
  if (!env.EMAIL_FROM || !(env.BREVO_API_KEY || env.EMAIL_API_KEY)) {
    return { resultado: 'Simulado', detalle: 'Sin proveedor de correo configurado (BREVO_API_KEY o EMAIL_API_KEY, y EMAIL_FROM).' };
  }
  try {
    if (env.BREVO_API_KEY) {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ sender: remitente(env.EMAIL_FROM), to: [{ email: para }], subject: asunto, htmlContent: html, textContent: texto })
      });
      if (!r.ok) return { resultado: 'Error', detalle: `Brevo ${r.status}: ${(await r.text()).slice(0, 250)}` };
      return { resultado: 'Enviado', detalle: 'Aceptado por Brevo' };
    }
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
