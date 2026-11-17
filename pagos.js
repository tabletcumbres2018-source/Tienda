// Pasarela de pago SANDBOX (simulada). No cobra dinero real ni contacta a ningún banco.
// Solo acepta tarjetas de prueba; cualquier otro número se rechaza para no manejar tarjetas reales.
// Para pasar a producción se reemplaza procesarPago() por la llamada al SDK del proveedor
// (Stripe, Mercado Pago, etc.) sin cambiar el resto del servidor.
const crypto = require('crypto');

const TARJETAS_PRUEBA = {
  '4242424242424242': { ok: true,  marca: 'Visa' },
  '5555555555554444': { ok: true,  marca: 'Mastercard' },
  '4000000000000002': { ok: false, marca: 'Visa', motivo: 'Tarjeta rechazada por el banco emisor.' },
  '4000000000009995': { ok: false, marca: 'Visa', motivo: 'Fondos insuficientes.' },
  '4000000000000069': { ok: false, marca: 'Visa', motivo: 'Tarjeta vencida.' }
};

function luhn(num) {
  let suma = 0, doble = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = +num[i];
    if (doble) { d *= 2; if (d > 9) d -= 9; }
    suma += d; doble = !doble;
  }
  return suma % 10 === 0;
}

function validarTarjeta({ numero, nombre, exp, cvv }) {
  const n = String(numero || '').replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(n) || !luhn(n)) return 'Número de tarjeta inválido.';
  if (!String(nombre || '').trim()) return 'Escribe el nombre que aparece en la tarjeta.';
  const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(String(exp || '').trim());
  if (!m || +m[1] < 1 || +m[1] > 12) return 'Fecha de vencimiento inválida (usa MM/AA).';
  const finMes = new Date(2000 + +m[2], +m[1], 0, 23, 59, 59);
  if (finMes < new Date()) return 'La tarjeta está vencida.';
  if (!/^\d{3,4}$/.test(String(cvv || ''))) return 'CVV inválido.';
  return null;
}

// Devuelve { aprobado, referencia, marca, ultimos4, motivo }
function procesarPago(tarjeta, monto) {
  const error = validarTarjeta(tarjeta);
  if (error) return { aprobado: false, motivo: error };

  const n = String(tarjeta.numero).replace(/[\s-]/g, '');
  const prueba = TARJETAS_PRUEBA[n];
  if (!prueba) {
    return { aprobado: false, motivo: 'Modo SANDBOX: usa una tarjeta de prueba (por ejemplo 4242 4242 4242 4242).' };
  }
  const base = { marca: prueba.marca, ultimos4: n.slice(-4), monto };
  if (!prueba.ok) return { ...base, aprobado: false, motivo: prueba.motivo };
  return { ...base, aprobado: true, referencia: 'sbx_' + crypto.randomBytes(6).toString('hex') };
}

module.exports = { procesarPago };
