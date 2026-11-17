<?php
// Costo de envío por código postal (CP). Misma lógica que envio.js.
// Gratis hasta 500 km; más de 500 km, tarifa fija de $50 MXN.

const LIMITE_GRATIS_KM = 500;
const TARIFA_ENVIO = 50;

function estados_mx() {
    return [
        'Aguascalientes' => [21.88, -102.29], 'Baja California' => [32.52, -117.04], 'Baja California Sur' => [24.14, -110.31],
        'Campeche' => [19.85, -90.53], 'Chiapas' => [16.75, -93.12], 'Chihuahua' => [28.63, -106.07],
        'Ciudad de México' => [19.43, -99.13], 'Coahuila' => [25.43, -101.0], 'Colima' => [19.24, -103.72],
        'Durango' => [24.02, -104.65], 'Estado de México' => [19.29, -99.65], 'Guanajuato' => [21.02, -101.26],
        'Guerrero' => [17.55, -99.5], 'Hidalgo' => [20.12, -98.73], 'Jalisco' => [20.66, -103.35],
        'Michoacán' => [19.7, -101.19], 'Morelos' => [18.92, -99.23], 'Nayarit' => [21.5, -104.89],
        'Nuevo León' => [25.67, -100.31], 'Oaxaca' => [17.07, -96.72], 'Puebla' => [19.04, -98.2],
        'Querétaro' => [20.59, -100.39], 'Quintana Roo' => [18.5, -88.3], 'San Luis Potosí' => [22.15, -100.98],
        'Sinaloa' => [24.8, -107.39], 'Sonora' => [29.07, -110.96], 'Tabasco' => [17.99, -92.93],
        'Tamaulipas' => [23.74, -99.15], 'Tlaxcala' => [19.32, -98.24], 'Veracruz' => [19.17, -96.13],
        'Yucatán' => [20.97, -89.62], 'Zacatecas' => [22.77, -102.58],
    ];
}

function rangos_cp() {
    return [
        [1, 16, 'Ciudad de México'], [20, 20, 'Aguascalientes'], [21, 22, 'Baja California'], [23, 23, 'Baja California Sur'],
        [24, 24, 'Campeche'], [25, 27, 'Coahuila'], [28, 28, 'Colima'], [29, 30, 'Chiapas'], [31, 33, 'Chihuahua'],
        [34, 35, 'Durango'], [36, 38, 'Guanajuato'], [39, 41, 'Guerrero'], [42, 43, 'Hidalgo'], [44, 49, 'Jalisco'],
        [50, 57, 'Estado de México'], [58, 61, 'Michoacán'], [62, 62, 'Morelos'], [63, 63, 'Nayarit'],
        [64, 67, 'Nuevo León'], [68, 71, 'Oaxaca'], [72, 75, 'Puebla'], [76, 76, 'Querétaro'], [77, 77, 'Quintana Roo'],
        [78, 79, 'San Luis Potosí'], [80, 82, 'Sinaloa'], [83, 85, 'Sonora'], [86, 86, 'Tabasco'],
        [87, 89, 'Tamaulipas'], [90, 90, 'Tlaxcala'], [91, 96, 'Veracruz'], [97, 97, 'Yucatán'], [98, 99, 'Zacatecas'],
    ];
}

function estado_de_cp($cp) {
    $pref = (int)substr($cp, 0, 2);
    foreach (rangos_cp() as $r) {
        if ($pref >= $r[0] && $pref <= $r[1]) return $r[2];
    }
    return null;
}

function haversine_km($a, $b) {
    $rad = function ($x) { return $x * M_PI / 180; };
    $h = pow(sin($rad($b[0] - $a[0]) / 2), 2) +
         cos($rad($a[0])) * cos($rad($b[0])) * pow(sin($rad($b[1] - $a[1]) / 2), 2);
    return 6371 * 2 * asin(sqrt($h));
}

// Devuelve ['error' => ...] o ['cp','estado','distanciaKm','costo','gratis','origen']
function calcular_envio($cp) {
    $cp = trim((string)$cp);
    if (!preg_match('/^\d{5}$/', $cp)) return ['error' => 'El código postal debe tener 5 dígitos.'];
    $estado = estado_de_cp($cp);
    if ($estado === null) return ['error' => 'Código postal no válido en México.'];

    $origen = config()['origen_estado'] ?? 'Ciudad de México';
    $estados = estados_mx();
    if (!isset($estados[$origen])) $origen = 'Ciudad de México';

    $km = ($estado === $origen)
        ? 20
        : max(20, (int)(round(haversine_km($estados[$origen], $estados[$estado]) / 10) * 10));
    $costo = $km > LIMITE_GRATIS_KM ? TARIFA_ENVIO : 0;
    return ['cp' => $cp, 'estado' => $estado, 'distanciaKm' => $km, 'costo' => $costo, 'gratis' => $costo === 0, 'origen' => $origen];
}
