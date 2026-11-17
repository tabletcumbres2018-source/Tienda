// Costo de envío por código postal (misma lógica que envio.js del servidor local).
// Gratis hasta 500 km desde el estado de la bodega; más de eso, tarifa fija de $50 MXN.
const LIMITE_GRATIS_KM = 500;
const TARIFA = 50;

const ESTADOS = {
  'Aguascalientes': [21.88, -102.29], 'Baja California': [32.52, -117.04], 'Baja California Sur': [24.14, -110.31],
  'Campeche': [19.85, -90.53], 'Chiapas': [16.75, -93.12], 'Chihuahua': [28.63, -106.07],
  'Ciudad de México': [19.43, -99.13], 'Coahuila': [25.43, -101.0], 'Colima': [19.24, -103.72],
  'Durango': [24.02, -104.65], 'Estado de México': [19.29, -99.65], 'Guanajuato': [21.02, -101.26],
  'Guerrero': [17.55, -99.5], 'Hidalgo': [20.12, -98.73], 'Jalisco': [20.66, -103.35],
  'Michoacán': [19.7, -101.19], 'Morelos': [18.92, -99.23], 'Nayarit': [21.5, -104.89],
  'Nuevo León': [25.67, -100.31], 'Oaxaca': [17.07, -96.72], 'Puebla': [19.04, -98.2],
  'Querétaro': [20.59, -100.39], 'Quintana Roo': [18.5, -88.3], 'San Luis Potosí': [22.15, -100.98],
  'Sinaloa': [24.8, -107.39], 'Sonora': [29.07, -110.96], 'Tabasco': [17.99, -92.93],
  'Tamaulipas': [23.74, -99.15], 'Tlaxcala': [19.32, -98.24], 'Veracruz': [19.17, -96.13],
  'Yucatán': [20.97, -89.62], 'Zacatecas': [22.77, -102.58]
};

const RANGOS = [
  [1, 16, 'Ciudad de México'], [20, 20, 'Aguascalientes'], [21, 22, 'Baja California'], [23, 23, 'Baja California Sur'],
  [24, 24, 'Campeche'], [25, 27, 'Coahuila'], [28, 28, 'Colima'], [29, 30, 'Chiapas'], [31, 33, 'Chihuahua'],
  [34, 35, 'Durango'], [36, 38, 'Guanajuato'], [39, 41, 'Guerrero'], [42, 43, 'Hidalgo'], [44, 49, 'Jalisco'],
  [50, 57, 'Estado de México'], [58, 61, 'Michoacán'], [62, 62, 'Morelos'], [63, 63, 'Nayarit'],
  [64, 67, 'Nuevo León'], [68, 71, 'Oaxaca'], [72, 75, 'Puebla'], [76, 76, 'Querétaro'], [77, 77, 'Quintana Roo'],
  [78, 79, 'San Luis Potosí'], [80, 82, 'Sinaloa'], [83, 85, 'Sonora'], [86, 86, 'Tabasco'],
  [87, 89, 'Tamaulipas'], [90, 90, 'Tlaxcala'], [91, 96, 'Veracruz'], [97, 97, 'Yucatán'], [98, 99, 'Zacatecas']
];

function estadoDeCP(cp) {
  const pref = parseInt(cp.slice(0, 2), 10);
  const r = RANGOS.find(([a, b]) => pref >= a && pref <= b);
  return r ? r[2] : null;
}

function haversineKm([la1, lo1], [la2, lo2]) {
  const rad = x => x * Math.PI / 180;
  const a = Math.sin(rad(la2 - la1) / 2) ** 2 +
            Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

// `origenEstado` viene de la variable ORIGEN_ESTADO de Cloudflare (por defecto Ciudad de México)
export function calcularEnvio(cp, origenEstado) {
  const ORIGEN = ESTADOS[origenEstado] ? origenEstado : 'Ciudad de México';
  cp = String(cp || '').trim();
  if (!/^\d{5}$/.test(cp)) return { error: 'El código postal debe tener 5 dígitos.' };
  const estado = estadoDeCP(cp);
  if (!estado) return { error: 'Código postal no válido en México.' };

  const distanciaKm = estado === ORIGEN
    ? 20
    : Math.max(20, Math.round(haversineKm(ESTADOS[ORIGEN], ESTADOS[estado]) / 10) * 10);
  const costo = distanciaKm > LIMITE_GRATIS_KM ? TARIFA : 0;
  return { cp, estado, distanciaKm, costo, gratis: costo === 0, origen: ORIGEN };
}
