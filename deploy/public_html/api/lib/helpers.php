<?php
// Utilidades comunes: configuración, respuestas JSON, base de datos y autenticación de admin.
// Compatible con PHP 7.4+ (Hostgator).

function config() {
    static $cfg = null;
    if ($cfg === null) {
        $archivo = __DIR__ . '/../config.php';
        if (!is_file($archivo)) {
            json_out(500, ['error' => 'Falta api/config.php. Copia api/config.sample.php como api/config.php y llena tus datos.']);
        }
        $cfg = require $archivo;
        date_default_timezone_set($cfg['zona_horaria'] ?? 'America/Mexico_City');
    }
    return $cfg;
}

function json_out($codigo, $datos) {
    http_response_code($codigo);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($datos, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    exit;
}

function cuerpo_json() {
    $crudo = file_get_contents('php://input');
    $j = json_decode($crudo === false ? '' : $crudo, true);
    return is_array($j) ? $j : [];
}

function db() {
    static $pdo = null;
    if ($pdo === null) {
        $c = config()['db'];
        $dsn = "mysql:host={$c['host']};dbname={$c['nombre']};charset=utf8mb4";
        $pdo = new PDO($dsn, $c['usuario'], $c['clave'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    }
    return $pdo;
}

function consulta($sql, $params = []) {
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st;
}

function requiere_admin() {
    $dada = isset($_SERVER['HTTP_X_ADMIN_KEY']) ? (string)$_SERVER['HTTP_X_ADMIN_KEY'] : '';
    $real = (string)(config()['clave_admin'] ?? '');
    if ($real === '' || !hash_equals(hash('sha256', $real), hash('sha256', $dada))) {
        json_out(401, ['error' => 'Clave de administrador incorrecta.']);
    }
}

function esc_html($s) {
    return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function mxn($n) {
    return '$' . number_format((float)$n, 2, '.', ',') . ' MXN';
}
