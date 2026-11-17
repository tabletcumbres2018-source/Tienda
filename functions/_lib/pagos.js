// Pasarela de pago SANDBOX (simulada). No cobra dinero real ni contacta a ningún banco.
// Solo acepta tarjetas de prueba. Para cobrar de verdad se reemplaza procesarPago() por el SDK del proveedor.
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

function referenciaAleatoria() {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return 'sbx_' + [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// Devuelve { aprobado, referencia, marca, ultimos4, motivo }
export function procesarPago(tarjeta, monto) {
  const error = validarTarjeta(tarjeta);
  if (error) return { aprobado: false, motivo: error };

  const n = String(tarjeta.numero).replace(/[\s-]/g, '');
  const prueba = TARJETAS_PRUEBA[n];
  if (!prueba) {
    return { aprobado: false, motivo: 'Modo SANDBOX: usa una tarjeta de prueba (por ejemplo 4242 4242 4242 4242).' };
  }
  const base = { marca: prueba.marca, ultimos4: n.slice(-4), monto };
  if (!prueba.ok) return { ...base, aprobado: false, motivo: prueba.motivo };
  return { ...base, aprobado: true, referencia: referenciaAleatoria() };
}
