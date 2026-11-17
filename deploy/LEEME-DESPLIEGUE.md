# Despliegue en Hostgator (hosting compartido, cPanel)

Hostgator ofrece **PHP + MySQL**, no SQL Server. Por eso producción usa la versión PHP del backend
(`public_html/api/`) y los datos de tu SQL Server se pasan a MySQL con los archivos de `mysql/`.
Tu versión local (Node + SQL Server) sigue funcionando igual para desarrollar.

## Qué hay en esta carpeta

```
deploy/
├─ mysql/
│  ├─ 01_esquema.sql        tablas (Productos, Pedidos, DetallePedido, CorreosPedido, Resenas, Anuncios)
│  └─ 02_productos.sql      tus 500 productos + anuncios de ejemplo
└─ public_html/             <- TODO esto se sube al servidor
   ├─ index.html            tienda
   ├─ admin/index.html      panel de ventas (KPIs)
   ├─ .htaccess             enruta /api/... a PHP y protege archivos
   └─ api/
      ├─ index.php          backend
      ├─ config.sample.php  plantilla de configuración
      └─ lib/               envío por CP, pasarela sandbox, correo
```

## Antes de subir (en tu PC)

1. Con el servidor local encendido, regenera los datos si cambiaste productos:
   `node tools/exportar-mysql.js`
2. Copia el front actual al paquete:
   `node tools/preparar-despliegue.js`

## Pasos en Hostgator (cPanel)

1. **Base de datos.** cPanel → *Bases de datos MySQL*:
   crea una base (ej. `megastore`), crea un usuario con contraseña larga y **asigna el usuario a la base con "Todos los privilegios"**.
   Anota los nombres completos (cPanel les antepone tu usuario: `usuario_megastore`).
2. **Importar datos.** cPanel → *phpMyAdmin* → selecciona tu base → pestaña *Importar*:
   primero `mysql/01_esquema.sql`, después `mysql/02_productos.sql` (cotejamiento utf8mb4).
3. **Configuración.** En el *Administrador de archivos*, dentro de `public_html/api/`,
   copia `config.sample.php` como **`config.php`** y edítalo: datos de MySQL, `clave_admin` (larga y única),
   `origen_estado` (estado de tu bodega) y el correo remitente.
   Edítalo en el editor de cPanel o guárdalo como **UTF-8 sin BOM**: un BOM (típico del Bloc de notas de Windows)
   hace que todas las respuestas de la API lleguen corruptas.
4. **Correo remitente.** cPanel → *Cuentas de correo*: crea `tienda@tudominio.com` y ponlo en `correo.from`.
   En *Email Deliverability* revisa que SPF y DKIM estén en verde; sin eso los correos pueden caer en spam.
5. **Subir archivos.** Sube **todo el contenido** de `deploy/public_html/` a la carpeta `public_html/` de tu dominio
   (Administrador de archivos o FTP). Incluye el archivo oculto `.htaccess`
   (en el Administrador de archivos activa *Mostrar archivos ocultos*). No subas `config.php` por FTP sin cifrar: créalo en el servidor.
6. **HTTPS.** cPanel → *SSL/TLS Status* → ejecuta AutoSSL. Cuando el candado funcione, quita el `#` de las dos líneas
   de redirección a HTTPS al final del `.htaccess`. **El panel admin envía la clave en cada petición: úsalo solo con HTTPS.**
7. **PHP.** cPanel → *Seleccionar versión de PHP*: 7.4 o superior (recomendado 8.1+), con extensiones `pdo_mysql` y `mbstring`.

## Verificación (en este orden)

| Prueba | Esperado |
|---|---|
| `https://tudominio.com/api/productos` | JSON con 500 productos |
| `https://tudominio.com/api/envio?cp=64000` | `{"estado":"Nuevo León", ...}` |
| `https://tudominio.com/` | la tienda con productos, banners e imágenes |
| Registrarte, comprar con `4242 4242 4242 4242` | recibo con folio `MS-000001` |
| `https://tudominio.com/admin/` con tu `clave_admin` | KPIs y el pedido |
| Cambiar el pedido a *Enviado* en el panel | correo al cliente y fila en "Correos al cliente" |

Si `/api/...` da 404 o descarga el PHP: `.htaccess` no se subió o `mod_rewrite` está desactivado (pide a soporte de Hostgator activarlo).
Si da `Falta api/config.php`: falta el paso 3. Los errores técnicos quedan en el log de PHP (cPanel → *Errores*).

## Límites a conocer

- **Pasarela en sandbox:** solo acepta tarjetas de prueba y no cobra. Para cobrar de verdad hay que integrar un proveedor
  (Mercado Pago, Stripe, PayPal) reemplazando `procesar_pago()` en `api/lib/pagos.php`.
- **Usuarios y reseñas** siguen en el navegador (`localStorage`), no en MySQL; la API confía en el correo que manda la página.
  Antes de operar con clientes reales conviene pasar cuentas y contraseñas (con hash) al servidor.
- **Correo con `mail()`:** "Enviado" significa que el servidor lo aceptó, no que llegó a la bandeja. Para más control usa SMTP (PHPMailer).
- El envío por CP usa distancia entre capitales de estado (aproximada).
- `deploy/public_html` asume que la tienda vive en la **raíz** del dominio (no en una subcarpeta).

## Si prefieres VPS (DigitalOcean / Linux)

El mismo `server.js` (Node) puede correr en un VPS, pero hoy habla con SQL Server local. En un VPS lo natural es
Node/PHP + MySQL con estos mismos archivos de `mysql/`. Dime y adapto la configuración (Nginx, PM2, HTTPS con Certbot).
