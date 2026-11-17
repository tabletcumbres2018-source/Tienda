<?php
// Copia este archivo como  api/config.php  y llena tus datos. NO subas config.php a GitHub.
// Los datos de MySQL los creas en cPanel > "Bases de datos MySQL".
return [
    'db' => [
        'host'    => 'localhost',
        'nombre'  => 'cpaneluser_megastore',   // cPanel antepone tu usuario al nombre
        'usuario' => 'cpaneluser_tienda',
        'clave'   => 'CAMBIA_ESTA_CLAVE',
    ],

    // Clave para entrar a /admin/ (panel de ventas). Usa una larga y única.
    'clave_admin' => 'CAMBIA_ESTA_CLAVE_ADMIN',

    // Estado desde donde envías (bodega). Define el costo de envío por código postal.
    'origen_estado' => 'Ciudad de México',

    'zona_horaria' => 'America/Mexico_City',

    // Correo de estado del pedido (usa mail() de PHP).
    // "from" debe ser una cuenta de TU dominio (créala en cPanel > Cuentas de correo), p. ej. tienda@tudominio.com
    'correo' => [
        'activo'      => true,
        'from'        => 'tienda@tudominio.com',
        'from_nombre' => 'LocalStorage',
    ],
];
