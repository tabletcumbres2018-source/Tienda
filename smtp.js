// Envío real de correos por SMTP (nodemailer).
// Se activa llenando la sección "smtp" de admin.config.json. Si está vacía, el correo se SIMULA (queda en CorreosPedido).
//
// Ejemplo con Gmail (necesitas una "contraseña de aplicación", NO tu contraseña normal):
//   "smtp": { "host": "smtp.gmail.com", "port": 465, "secure": true,
//             "user": "tucuenta@gmail.com", "pass": "xxxx xxxx xxxx xxxx",
//             "from": "tucuenta@gmail.com", "nombre": "LocalStorage" }
const fs = require('fs');
const nodemailer = require('nodemailer');

function leerSmtp() {
  try {
    const c = JSON.parse(fs.readFileSync(__dirname + '/admin.config.json', 'utf8')).smtp;
    return c && c.host && c.user && c.pass && c.from ? c : null;
  } catch { return null; }
}

const correoValido = s => /^\S+@\S+\.\S+$/.test(String(s || ''));

// Devuelve { resultado: 'Enviado' | 'Error' | 'Simulado', detalle }. Nunca lanza: un fallo de correo no debe romper la compra.
// `opciones.cfg` / `opciones.transporte` existen para poder probar sin red.
async function enviarCorreo({ para, asunto, texto, html }, opciones = {}) {
  const cfg = opciones.cfg || leerSmtp();
  if (!cfg) return { resultado: 'Simulado', detalle: 'SMTP sin configurar en admin.config.json: correo simulado, no se envió por internet.' };
  if (!correoValido(para)) return { resultado: 'Error', detalle: 'El correo del cliente no es válido.' };

  try {
    const puerto = Number(cfg.port) || 465;
    const transporte = opciones.transporte || nodemailer.createTransport({
      host: cfg.host, port: puerto, secure: cfg.secure ?? puerto === 465,
      auth: { user: cfg.user, pass: cfg.pass },
      connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 12000
    });
    const info = await transporte.sendMail({
      from: `"${(cfg.nombre || 'LocalStorage').replace(/"/g, '')}" <${cfg.from}>`,
      to: para, subject: asunto, text: texto, html
    });
    return { resultado: 'Enviado', detalle: `SMTP aceptó el correo${info.messageId ? ' (' + info.messageId + ')' : ''}.`.slice(0, 300) };
  } catch (e) {
    return { resultado: 'Error', detalle: ('SMTP: ' + e.message).slice(0, 300) };
  }
}

module.exports = { enviarCorreo, leerSmtp };
