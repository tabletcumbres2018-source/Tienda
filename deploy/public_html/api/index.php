<?php
// Backend de LocalStorage en PHP + MySQL (Hostgator). Mismo contrato que server.js (Node + SQL Server).
// Todas las rutas /api/... llegan aquí gracias al .htaccess de la raíz.

require __DIR__ . '/lib/helpers.php';
require __DIR__ . '/lib/envio.php';
require __DIR__ . '/lib/pagos.php';
require __DIR__ . '/lib/correo.php';

set_exception_handler(function ($e) {
    error_log('API: ' . $e->getMessage());
    json_out(500, ['error' => 'Error interno del servidor.']);
});

$metodo = $_SERVER['REQUEST_METHOD'];
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$pos = strpos($uri, '/api/');
$ruta = '/' . trim($pos === false ? '' : substr($uri, $pos + 5), '/');

// ---------- Catálogo ----------
if ($metodo === 'GET' && $ruta === '/productos') {
    $filas = consulta('SELECT Id, Titulo, Categoria, Marca, Precio, Caracteristicas, Colores, Imagen FROM Productos ORDER BY Id')->fetchAll();
    $salida = [];
    foreach ($filas as $p) {
        $salida[] = [
            'id' => (int)$p['Id'] - 1,
            'idDb' => (int)$p['Id'],
            't' => $p['Titulo'], 'n' => $p['Titulo'],
            'c' => $p['Categoria'], 'm' => $p['Marca'],
            'p' => (float)$p['Precio'],
            'f' => array_values(array_filter(array_map('trim', explode('|', $p['Caracteristicas'])), 'strlen')),
            'colores' => array_values(array_filter(array_map('trim', explode(',', $p['Colores'])), 'strlen')),
            'img' => $p['Imagen'],
            'k' => mb_strtolower($p['Categoria'] . ' ' . $p['Marca'], 'UTF-8'),
        ];
    }
    json_out(200, $salida);
}

if ($metodo === 'GET' && $ruta === '/anuncios') {
    $filas = consulta('SELECT Id, Tipo, Titulo, Texto, Boton, Categoria, Tema, ProductoId FROM Anuncios WHERE Activo = 1 ORDER BY Orden, Id')->fetchAll();
    $banners = []; $productos = [];
    foreach ($filas as $a) {
        if ($a['Tipo'] === 'banner') {
            $banners[] = ['id' => (int)$a['Id'], 'titulo' => $a['Titulo'], 'texto' => $a['Texto'], 'boton' => $a['Boton'], 'categoria' => $a['Categoria'], 'tema' => $a['Tema']];
        } elseif ($a['ProductoId']) {
            $productos[] = (int)$a['ProductoId'];
        }
    }
    json_out(200, ['banners' => $banners, 'productos' => $productos]);
}

// ---------- Envío por código postal ----------
if ($metodo === 'GET' && $ruta === '/envio') {
    $r = calcular_envio($_GET['cp'] ?? '');
    json_out(isset($r['error']) ? 400 : 200, $r);
}

// ---------- Pedidos del cliente ----------
if ($metodo === 'POST' && $ruta === '/pedidos') {
    $d = cuerpo_json();
    $nombre = trim((string)($d['usuario']['nombre'] ?? ''));
    $correo = strtolower(trim((string)($d['usuario']['correo'] ?? '')));
    if ($nombre === '' || !filter_var($correo, FILTER_VALIDATE_EMAIL)) json_out(400, ['error' => 'Usuario no válido. Inicia sesión.']);
    $direccion = trim((string)($d['direccion'] ?? ''));
    $referencias = trim((string)($d['referencias'] ?? ''));
    if ($direccion === '' || $referencias === '') json_out(400, ['error' => 'Completa la dirección y las referencias.']);
    $items = $d['items'] ?? null;
    if (!is_array($items) || !count($items) || count($items) > 100) json_out(400, ['error' => 'El carrito está vacío.']);

    $envio = calcular_envio($d['cp'] ?? '');
    if (isset($envio['error'])) json_out(400, ['error' => $envio['error']]);

    $partidas = [];
    foreach ($items as $i) {
        $id = filter_var($i['idDb'] ?? null, FILTER_VALIDATE_INT);
        $cant = filter_var($i['cantidad'] ?? null, FILTER_VALIDATE_INT);
        if ($id === false || $id < 1 || $cant === false || $cant < 1 || $cant > 99) {
            json_out(400, ['error' => 'Hay productos o cantidades no válidas en el carrito.']);
        }
        $partidas[] = ['id' => $id, 'cantidad' => $cant, 'color' => mb_substr((string)($i['color'] ?? 'Único'), 0, 50)];
    }

    // Precios desde la base, nunca desde el navegador
    $ids = array_values(array_unique(array_column($partidas, 'id')));
    $marcas = implode(',', array_fill(0, count($ids), '?'));
    $catalogo = [];
    foreach (consulta("SELECT Id, Titulo, Precio FROM Productos WHERE Id IN ($marcas)", $ids)->fetchAll() as $p) {
        $catalogo[(int)$p['Id']] = $p;
    }
    foreach ($ids as $id) if (!isset($catalogo[$id])) json_out(400, ['error' => 'Un producto del carrito ya no existe.']);

    $subtotal = 0.0;
    foreach ($partidas as $p) $subtotal += (float)$catalogo[$p['id']]['Precio'] * $p['cantidad'];
    $total = $subtotal + $envio['costo'];

    // Cobro sandbox ANTES de guardar; si se rechaza no se crea pedido
    $pago = procesar_pago($d['tarjeta'] ?? [], $total);
    if (!$pago['aprobado']) json_out(402, ['error' => $pago['motivo'], 'pagoRechazado' => true]);

    $pdo = db();
    $pdo->beginTransaction();
    try {
        consulta('INSERT INTO Pedidos (ClienteNombre, ClienteCorreo, Direccion, Referencias, CodigoPostal, EstadoEnvio, DistanciaKm,
                                       Subtotal, CostoEnvio, Total, Estado, MetodoPago, PagoReferencia, TarjetaUltimos4, Fecha)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [mb_substr($nombre, 0, 100), mb_substr($correo, 0, 150), mb_substr($direccion, 0, 300), mb_substr($referencias, 0, 500),
             $envio['cp'], $envio['estado'], $envio['distanciaKm'], round($subtotal, 2), $envio['costo'], round($total, 2),
             'Pagado', "Tarjeta {$pago['marca']} (sandbox)", $pago['referencia'], $pago['ultimos4'], date('Y-m-d H:i:s')]);
        $pedidoId = (int)$pdo->lastInsertId();
        $folio = 'MS-' . str_pad((string)$pedidoId, 6, '0', STR_PAD_LEFT);
        consulta('UPDATE Pedidos SET Folio = ? WHERE Id = ?', [$folio, $pedidoId]);
        foreach ($partidas as $p) {
            consulta('INSERT INTO DetallePedido (PedidoId, ProductoId, Producto, Color, Cantidad, PrecioUnitario) VALUES (?,?,?,?,?,?)',
                [$pedidoId, $p['id'], $catalogo[$p['id']]['Titulo'], $p['color'], $p['cantidad'], $catalogo[$p['id']]['Precio']]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }

    notificar_pedido($pedidoId); // no rompe la compra si el correo falla
    json_out(201, [
        'folio' => $folio, 'estado' => 'Pagado', 'fecha' => date('c'),
        'subtotal' => round($subtotal, 2), 'costoEnvio' => $envio['costo'], 'total' => round($total, 2),
        'estadoEnvio' => $envio['estado'], 'pagoReferencia' => $pago['referencia'],
    ]);
}

if ($metodo === 'GET' && $ruta === '/pedidos') {
    $correo = strtolower(trim((string)($_GET['correo'] ?? '')));
    if ($correo === '') json_out(400, ['error' => 'Falta el correo.']);
    $peds = consulta('SELECT Id, Folio, Estado, Fecha, Subtotal, CostoEnvio, Total, CodigoPostal, EstadoEnvio, MetodoPago FROM Pedidos WHERE ClienteCorreo = ? ORDER BY Fecha DESC', [$correo])->fetchAll();
    $salida = [];
    foreach ($peds as $p) {
        $det = consulta('SELECT Producto, Color, Cantidad, PrecioUnitario FROM DetallePedido WHERE PedidoId = ?', [$p['Id']])->fetchAll();
        $salida[] = [
            'Id' => (int)$p['Id'], 'Folio' => $p['Folio'], 'Estado' => $p['Estado'], 'Fecha' => date('c', strtotime($p['Fecha'])),
            'Subtotal' => (float)$p['Subtotal'], 'CostoEnvio' => (float)$p['CostoEnvio'], 'Total' => (float)$p['Total'],
            'CodigoPostal' => $p['CodigoPostal'], 'EstadoEnvio' => $p['EstadoEnvio'], 'MetodoPago' => $p['MetodoPago'],
            'items' => array_map(function ($d) {
                return ['Producto' => $d['Producto'], 'Color' => $d['Color'], 'Cantidad' => (int)$d['Cantidad'], 'PrecioUnitario' => (float)$d['PrecioUnitario']];
            }, $det),
        ];
    }
    json_out(200, $salida);
}

// ---------- Reseñas ----------
if ($metodo === 'GET' && $ruta === '/resenas/resumen') {
    $salida = [];
    foreach (consulta('SELECT ProductoId, COUNT(*) AS n, AVG(Calificacion) AS promedio FROM Resenas GROUP BY ProductoId')->fetchAll() as $f) {
        $salida[(string)$f['ProductoId']] = ['n' => (int)$f['n'], 'promedio' => round((float)$f['promedio'], 1)];
    }
    json_out(200, (object)$salida); // objeto {} aunque no haya reseñas
}

if ($metodo === 'GET' && $ruta === '/resenas') {
    $id = filter_var($_GET['producto'] ?? null, FILTER_VALIDATE_INT);
    if ($id === false || $id < 1) json_out(400, ['error' => 'Producto no válido.']);
    $filas = consulta('SELECT ClienteNombre, Calificacion, Comentario, Fecha FROM Resenas WHERE ProductoId = ? ORDER BY Fecha DESC, Id DESC', [$id])->fetchAll();
    // No se expone el correo del autor
    json_out(200, array_map(function ($r) {
        return ['usuario' => $r['ClienteNombre'], 'calificacion' => (int)$r['Calificacion'], 'comentario' => $r['Comentario'], 'fecha' => date('c', strtotime($r['Fecha']))];
    }, $filas));
}

if ($metodo === 'POST' && $ruta === '/resenas') {
    $d = cuerpo_json();
    $nombre = trim((string)($d['usuario']['nombre'] ?? ''));
    $correo = strtolower(trim((string)($d['usuario']['correo'] ?? '')));
    $id = filter_var($d['producto'] ?? null, FILTER_VALIDATE_INT);
    $estrellas = filter_var($d['calificacion'] ?? null, FILTER_VALIDATE_INT);
    $texto = trim((string)($d['comentario'] ?? ''));
    if ($nombre === '' || !filter_var($correo, FILTER_VALIDATE_EMAIL)) json_out(400, ['error' => 'Inicia sesión para publicar una reseña.']);
    if ($id === false || $id < 1) json_out(400, ['error' => 'Producto no válido.']);
    if ($estrellas === false || $estrellas < 1 || $estrellas > 5) json_out(400, ['error' => 'La calificación debe ser de 1 a 5.']);
    if ($texto === '' || mb_strlen($texto) > 500) json_out(400, ['error' => 'El comentario debe tener entre 1 y 500 caracteres.']);
    if (!consulta('SELECT 1 FROM Productos WHERE Id = ?', [$id])->fetch()) json_out(404, ['error' => 'El producto no existe.']);
    try {
        consulta('INSERT INTO Resenas (ProductoId, ClienteNombre, ClienteCorreo, Calificacion, Comentario, Fecha) VALUES (?,?,?,?,?,?)',
            [$id, mb_substr($nombre, 0, 100), mb_substr($correo, 0, 150), $estrellas, $texto, date('Y-m-d H:i:s')]);
    } catch (PDOException $e) {
        if (isset($e->errorInfo[1]) && (int)$e->errorInfo[1] === 1062) json_out(409, ['error' => 'Ya publicaste una reseña de este producto.']);
        throw $e;
    }
    json_out(201, ['ok' => true]);
}

// ---------- Panel admin (cabecera x-admin-key) ----------
if ($metodo === 'GET' && $ruta === '/admin/kpis') {
    requiere_admin();
    $tot = consulta("SELECT COALESCE(SUM(Total),0) AS ventas, COUNT(*) AS pedidos, COALESCE(SUM(CostoEnvio),0) AS envios FROM Pedidos WHERE Estado <> 'Cancelado'")->fetch();
    $top = consulta("SELECT d.Producto, SUM(d.Cantidad) AS unidades FROM DetallePedido d JOIN Pedidos p ON p.Id = d.PedidoId
                     WHERE p.Estado <> 'Cancelado' GROUP BY d.ProductoId, d.Producto ORDER BY unidades DESC, d.Producto LIMIT 1")->fetch();
    $porCat = consulta("SELECT pr.Categoria AS categoria, SUM(d.Cantidad * d.PrecioUnitario) AS ventas, SUM(d.Cantidad) AS unidades
                        FROM DetallePedido d JOIN Pedidos p ON p.Id = d.PedidoId JOIN Productos pr ON pr.Id = d.ProductoId
                        WHERE p.Estado <> 'Cancelado' GROUP BY pr.Categoria ORDER BY ventas DESC")->fetchAll();
    $porEstado = consulta('SELECT Estado AS estado, COUNT(*) AS pedidos FROM Pedidos GROUP BY Estado')->fetchAll();
    $desde = date('Y-m-d 00:00:00', strtotime('-29 days'));
    $porDia = consulta("SELECT DATE_FORMAT(Fecha, '%Y-%m-%d') AS dia, SUM(Total) AS ventas, COUNT(*) AS pedidos FROM Pedidos
                        WHERE Estado <> 'Cancelado' AND Fecha >= ? GROUP BY dia ORDER BY dia", [$desde])->fetchAll();

    $pagados = 0;
    foreach ($porEstado as $e) if ($e['estado'] === 'Pagado') $pagados = (int)$e['pedidos'];
    $n = (int)$tot['pedidos'];
    json_out(200, [
        'ventasTotales' => (float)$tot['ventas'], 'pedidos' => $n,
        'ticketPromedio' => $n ? (float)$tot['ventas'] / $n : 0,
        'ingresoEnvios' => (float)$tot['envios'],
        'productoTop' => $top ? ['nombre' => $top['Producto'], 'unidades' => (int)$top['unidades']] : null,
        'porEnviar' => $pagados,
        'porCategoria' => array_map(function ($c) { return ['categoria' => $c['categoria'], 'ventas' => (float)$c['ventas'], 'unidades' => (int)$c['unidades']]; }, $porCat),
        'porEstado' => array_map(function ($e) { return ['estado' => $e['estado'], 'pedidos' => (int)$e['pedidos']]; }, $porEstado),
        'porDia' => array_map(function ($d) { return ['dia' => $d['dia'], 'ventas' => (float)$d['ventas'], 'pedidos' => (int)$d['pedidos']]; }, $porDia),
    ]);
}

if ($metodo === 'GET' && $ruta === '/admin/pedidos') {
    requiere_admin();
    $peds = consulta('SELECT * FROM Pedidos ORDER BY Fecha DESC LIMIT 200')->fetchAll();
    $salida = [];
    foreach ($peds as $p) {
        $items = consulta('SELECT Producto, Color, Cantidad, PrecioUnitario FROM DetallePedido WHERE PedidoId = ?', [$p['Id']])->fetchAll();
        $correos = consulta('SELECT Asunto, Resultado, Fecha FROM CorreosPedido WHERE PedidoId = ? ORDER BY Fecha DESC, Id DESC', [$p['Id']])->fetchAll();
        $salida[] = [
            'folio' => $p['Folio'], 'estado' => $p['Estado'], 'fecha' => date('c', strtotime($p['Fecha'])),
            'cliente' => $p['ClienteNombre'], 'correo' => $p['ClienteCorreo'], 'direccion' => $p['Direccion'],
            'cp' => $p['CodigoPostal'], 'estadoEnvio' => $p['EstadoEnvio'],
            'subtotal' => (float)$p['Subtotal'], 'envio' => (float)$p['CostoEnvio'], 'total' => (float)$p['Total'],
            'items' => array_map(function ($i) {
                return ['producto' => $i['Producto'], 'color' => $i['Color'], 'cantidad' => (int)$i['Cantidad'], 'precio' => (float)$i['PrecioUnitario']];
            }, $items),
            'correos' => array_map(function ($c) {
                return ['asunto' => $c['Asunto'], 'resultado' => $c['Resultado'], 'fecha' => date('c', strtotime($c['Fecha']))];
            }, $correos),
        ];
    }
    json_out(200, $salida);
}

// Cambio de estado: POST (o PATCH) /api/admin/pedidos/MS-000001/estado   { "estado": "Enviado" }
if (($metodo === 'POST' || $metodo === 'PATCH') && preg_match('#^/admin/pedidos/([A-Za-z0-9-]+)/estado$#', $ruta, $m)) {
    requiere_admin();
    $transiciones = ['Pendiente' => ['Pagado', 'Cancelado'], 'Pagado' => ['Enviado', 'Cancelado'], 'Enviado' => ['Entregado', 'Cancelado'], 'Entregado' => [], 'Cancelado' => []];
    $nuevo = (string)(cuerpo_json()['estado'] ?? '');
    if (!isset($transiciones[$nuevo])) json_out(400, ['error' => 'Estado no válido.']);
    $p = consulta('SELECT Id, Estado FROM Pedidos WHERE Folio = ?', [$m[1]])->fetch();
    if (!$p) json_out(404, ['error' => 'Pedido no encontrado.']);
    if (!in_array($nuevo, $transiciones[$p['Estado']] ?? [], true)) {
        json_out(409, ['error' => "No se puede pasar de \"{$p['Estado']}\" a \"$nuevo\"."]);
    }
    consulta('UPDATE Pedidos SET Estado = ? WHERE Id = ?', [$nuevo, $p['Id']]);
    notificar_pedido((int)$p['Id']);
    json_out(200, ['folio' => $m[1], 'estado' => $nuevo, 'correo' => 'registrado']);
}

json_out(404, ['error' => 'Ruta no encontrada.']);
