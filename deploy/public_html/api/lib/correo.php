<?php
// Correo de estado del pedido. Se envía con mail() de PHP (disponible en Hostgator) y queda
// registrado en la tabla CorreosPedido. Misma plantilla que mailer.js.

function textos_estado() {
    return [
        'Pagado'    => ['asunto' => 'Recibimos tu pago',        'mensaje' => 'Tu pago fue confirmado y ya estamos preparando tu pedido.'],
        'Enviado'   => ['asunto' => 'Tu pedido va en camino',   'mensaje' => 'Tu pedido salió de nuestra bodega y va en camino a tu domicilio.'],
        'Entregado' => ['asunto' => 'Tu pedido fue entregado',  'mensaje' => 'Tu pedido fue entregado. ¡Gracias por comprar con nosotros!'],
        'Cancelado' => ['asunto' => 'Tu pedido fue cancelado',  'mensaje' => 'Tu pedido fue cancelado. Si tienes dudas, respóndenos este correo.'],
    ];
}

function construir_correo($p, $items) {
    $t = textos_estado();
    $base = $t[$p['Estado']] ?? ['asunto' => 'Estado de tu pedido: ' . $p['Estado'], 'mensaje' => 'El estado de tu pedido ahora es "' . $p['Estado'] . '".'];
    $asunto = "Pedido {$p['Folio']}: {$base['asunto']}";
    $envio = ((float)$p['CostoEnvio'] > 0) ? mxn($p['CostoEnvio']) : 'Gratis';

    $lineas = [];
    $filas = '';
    foreach ($items as $i) {
        $sub = mxn($i['PrecioUnitario'] * $i['Cantidad']);
        $lineas[] = "{$i['Cantidad']} x {$i['Producto']} ({$i['Color']}) - $sub";
        $filas .= '<tr><td style="padding:4px 0">' . (int)$i['Cantidad'] . ' × ' . esc_html($i['Producto']) . ' (' . esc_html($i['Color']) . ')</td>'
                . '<td style="text-align:right">' . esc_html($sub) . '</td></tr>';
    }

    $texto = implode("\n", array_merge(
        ["Hola {$p['ClienteNombre']},", '', $base['mensaje'], '', "Folio: {$p['Folio']}", "Estado: {$p['Estado']}", ''],
        $lineas,
        ['', 'Subtotal: ' . mxn($p['Subtotal']), "Envío: $envio", 'Total: ' . mxn($p['Total']), '',
         "Entrega: {$p['Direccion']} (C.P. {$p['CodigoPostal']}, {$p['EstadoEnvio']})", '', 'LocalStorage']
    ));

    $html = '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#222">'
        . '<h2 style="margin-bottom:4px">LocalStorage</h2>'
        . '<p>Hola ' . esc_html($p['ClienteNombre']) . ',</p><p>' . esc_html($base['mensaje']) . '</p>'
        . '<p style="font-size:18px"><strong>' . esc_html($p['Folio']) . '</strong> · <span style="background:#e8f3ec;padding:2px 8px;border-radius:4px">' . esc_html($p['Estado']) . '</span></p>'
        . '<table style="width:100%;border-collapse:collapse;font-size:14px">' . $filas
        . '<tr><td style="padding-top:8px;border-top:1px solid #ddd">Envío</td><td style="text-align:right;border-top:1px solid #ddd;padding-top:8px">' . esc_html($envio) . '</td></tr>'
        . '<tr><td><strong>Total</strong></td><td style="text-align:right"><strong>' . esc_html(mxn($p['Total'])) . '</strong></td></tr></table>'
        . '<p style="font-size:13px;color:#555">Entrega en: ' . esc_html($p['Direccion']) . ' (C.P. ' . esc_html($p['CodigoPostal']) . ', ' . esc_html($p['EstadoEnvio']) . ')</p></div>';

    return ['asunto' => $asunto, 'texto' => $texto, 'html' => $html];
}

function codificar_asunto($s) {
    return '=?UTF-8?B?' . base64_encode($s) . '?=';
}

// Envía el correo y lo registra. Nunca lanza excepción: un fallo de correo no debe romper la compra ni el cambio de estado.
function notificar_pedido($pedidoId) {
    try {
        $p = consulta('SELECT * FROM Pedidos WHERE Id = ?', [$pedidoId])->fetch();
        if (!$p) return;
        $items = consulta('SELECT * FROM DetallePedido WHERE PedidoId = ?', [$pedidoId])->fetchAll();
        $c = construir_correo($p, $items);
        $cfg = config()['correo'] ?? [];

        $resultado = 'Simulado';
        $detalle = 'Envío de correo desactivado en config.php (correo.activo = false).';

        if (!empty($cfg['activo'])) {
            $from = $cfg['from'] ?? '';
            $nombre = $cfg['from_nombre'] ?? 'LocalStorage';
            $limite = 'ms_' . bin2hex(random_bytes(8));
            $cabeceras = [
                'MIME-Version: 1.0',
                'From: ' . codificar_asunto($nombre) . " <$from>",
                'Reply-To: ' . $from,
                "Content-Type: multipart/alternative; boundary=\"$limite\"",
            ];
            $cuerpo = "--$limite\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
                    . chunk_split(base64_encode($c['texto']))
                    . "--$limite\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
                    . chunk_split(base64_encode($c['html']))
                    . "--$limite--";
            // El 5.º parámetro (-f) fija el remitente del sobre; Hostgator lo requiere para entregar bien.
            $ok = $from !== '' && filter_var($p['ClienteCorreo'], FILTER_VALIDATE_EMAIL)
                && @mail($p['ClienteCorreo'], codificar_asunto($c['asunto']), $cuerpo, implode("\r\n", $cabeceras), '-f' . $from);
            $resultado = $ok ? 'Enviado' : 'Error';
            $detalle = $ok ? 'Aceptado por el servidor de correo (mail()).' : 'mail() devolvió false: revisa correo.from en config.php y que el cliente tenga un correo válido.';
        }

        consulta('INSERT INTO CorreosPedido (PedidoId, Para, Asunto, Cuerpo, Resultado, Detalle) VALUES (?,?,?,?,?,?)',
            [$pedidoId, $p['ClienteCorreo'], $c['asunto'], $c['texto'], $resultado, $detalle]);
    } catch (Throwable $e) {
        error_log('notificar_pedido: ' . $e->getMessage());
    }
}
