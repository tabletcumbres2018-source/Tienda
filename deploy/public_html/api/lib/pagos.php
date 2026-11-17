<?php
// Pasarela de pago SANDBOX (simulada). No cobra dinero real ni contacta a ningún banco.
// Solo acepta tarjetas de prueba; cualquier otro número se rechaza.
// Para producción se reemplaza procesar_pago() por la llamada al SDK del proveedor (Stripe, Mercado Pago...).

function tarjetas_prueba() {
    return [
        '4242424242424242' => ['ok' => true,  'marca' => 'Visa'],
        '5555555555554444' => ['ok' => true,  'marca' => 'Mastercard'],
        '4000000000000002' => ['ok' => false, 'marca' => 'Visa', 'motivo' => 'Tarjeta rechazada por el banco emisor.'],
        '4000000000009995' => ['ok' => false, 'marca' => 'Visa', 'motivo' => 'Fondos insuficientes.'],
        '4000000000000069' => ['ok' => false, 'marca' => 'Visa', 'motivo' => 'Tarjeta vencida.'],
    ];
}

function luhn_valido($num) {
    $suma = 0; $doble = false;
    for ($i = strlen($num) - 1; $i >= 0; $i--) {
        $d = (int)$num[$i];
        if ($doble) { $d *= 2; if ($d > 9) $d -= 9; }
        $suma += $d;
        $doble = !$doble;
    }
    return $suma % 10 === 0;
}

function validar_tarjeta($t) {
    $n = preg_replace('/[\s-]/', '', (string)($t['numero'] ?? ''));
    if (!preg_match('/^\d{13,19}$/', $n) || !luhn_valido($n)) return 'Número de tarjeta inválido.';
    if (trim((string)($t['nombre'] ?? '')) === '') return 'Escribe el nombre que aparece en la tarjeta.';
    if (!preg_match('/^(\d{2})\s*\/\s*(\d{2})$/', trim((string)($t['exp'] ?? '')), $m) || (int)$m[1] < 1 || (int)$m[1] > 12) {
        return 'Fecha de vencimiento inválida (usa MM/AA).';
    }
    $finMes = mktime(23, 59, 59, (int)$m[1] + 1, 0, 2000 + (int)$m[2]); // último día de ese mes
    if ($finMes < time()) return 'La tarjeta está vencida.';
    if (!preg_match('/^\d{3,4}$/', (string)($t['cvv'] ?? ''))) return 'CVV inválido.';
    return null;
}

// Devuelve ['aprobado','referencia','marca','ultimos4','motivo']
function procesar_pago($tarjeta, $monto) {
    $error = validar_tarjeta($tarjeta);
    if ($error !== null) return ['aprobado' => false, 'motivo' => $error];

    $n = preg_replace('/[\s-]/', '', (string)$tarjeta['numero']);
    $lista = tarjetas_prueba();
    if (!isset($lista[$n])) {
        return ['aprobado' => false, 'motivo' => 'Modo SANDBOX: usa una tarjeta de prueba (por ejemplo 4242 4242 4242 4242).'];
    }
    $p = $lista[$n];
    $base = ['marca' => $p['marca'], 'ultimos4' => substr($n, -4), 'monto' => $monto];
    if (!$p['ok']) return $base + ['aprobado' => false, 'motivo' => $p['motivo']];
    return $base + ['aprobado' => true, 'referencia' => 'sbx_' . bin2hex(random_bytes(6))];
}
