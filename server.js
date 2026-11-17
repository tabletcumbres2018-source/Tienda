// API de MegaStoreDB (SQL Server Express local) + servidor del index.html
// Uso: node server.js   ->   http://localhost:3000
const express = require('express');
const sql = require('mssql/msnodesqlv8'); // autenticación de Windows
const { calcularEnvio } = require('./envio');
const { procesarPago } = require('./pagos');
const fs = require('fs');
const crypto = require('crypto');
const { construirCorreo, ESTADOS_VALIDOS } = require('./mailer');
const { enviarCorreo } = require('./smtp');

// Clave del panel admin: variable ADMIN_KEY o archivo admin.config.json ({ "claveAdmin": "..." })
function leerClaveAdmin() {
  if (process.env.ADMIN_KEY) return process.env.ADMIN_KEY;
  try { return JSON.parse(fs.readFileSync(__dirname + '/admin.config.json', 'utf8')).claveAdmin || ''; } catch { return ''; }
}
const CLAVE_ADMIN = leerClaveAdmin();
const hash = s => crypto.createHash('sha256').update(String(s)).digest();
function requiereAdmin(req, res, next) {
  const dada = req.get('x-admin-key') || '';
  if (!CLAVE_ADMIN || !crypto.timingSafeEqual(hash(dada), hash(CLAVE_ADMIN))) {
    return res.status(401).json({ error: 'Clave de administrador incorrecta.' });
  }
  next();
}

const config = {
  server: 'localhost\\SQLEXPRESS',
  database: 'MegaStoreDB',
  driver: 'ODBC Driver 17 for SQL Server',
  options: { trustedConnection: true, trustServerCertificate: true }
};

const app = express();
app.use(express.json());
// Permite que index.html abierto desde file:// o Live Server consulte la API
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Fotos (Unsplash) que sí corresponden a cada categoría del catálogo.
// Se reparten por Id para dar variedad. No modifica la columna Imagen de la base.
const U = id => `https://images.unsplash.com/${id}?w=400`;
const IMAGENES_POR_CATEGORIA = {
  'Teléfonos': ['photo-1511707171634-5f897ff02aa9', 'photo-1598327105666-5b89351aff97'].map(U),
  'Televisores': ['photo-1593359677879-a4bb92f829d1', 'photo-1461151304267-38535e780c79', 'photo-1552975084-6e027cd345c2'].map(U),
  'Electrodomésticos': ['photo-1626806787461-102c1bfaaea1', 'photo-1574269909862-7e1d70bb8078', 'photo-1571175443880-49e1d25b2bc5', 'photo-1588854337221-4cf9fa96059c'].map(U),
  'Cómputo': ['photo-1496181133206-80ce9b88a853', 'photo-1517336714731-489689fd1ca8', 'photo-1525547719571-a2d4ac8945e2'].map(U),
  'Audio': ['photo-1505740420928-5e560c06d30e', 'photo-1546435770-a3e426bf472b', 'photo-1583394838336-acd977736f90', 'photo-1608043152269-423dbba4e7e1', 'photo-1572569511254-d8f925fe2cbb'].map(U),
  'Hogar y cocina': ['photo-1556911220-e15b29be8c8f', 'photo-1570222094114-d054a817e56b', 'photo-1585515320310-259814833e62'].map(U)
};
function crearSelectorImagen() {
  const contador = {};
  return p => {
    const pool = IMAGENES_POR_CATEGORIA[p.Categoria];
    if (!pool) return p.Imagen;
    const n = contador[p.Categoria] = (contador[p.Categoria] ?? -1) + 1;
    return pool[n % pool.length];
  };
}

let poolPromise;
const getPool = () => poolPromise || (poolPromise = new sql.ConnectionPool(config).connect());

// Productos: formato que espera index.html
app.get('/api/productos', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(
      'SELECT Id, Titulo, Categoria, Marca, Precio, Caracteristicas, Colores, Imagen FROM Productos ORDER BY Id');
    const imagenDe = crearSelectorImagen();
    res.json(r.recordset.map(p => ({
      id: p.Id - 1,                      // el front usa índices 0..499
      idDb: p.Id,
      t: p.Titulo,
      n: p.Titulo,
      c: p.Categoria,
      m: p.Marca,
      p: Number(p.Precio),
      f: p.Caracteristicas.split('|').map(s => s.trim()).filter(Boolean),
      colores: p.Colores.split(',').map(s => s.trim()).filter(Boolean),
      img: imagenDe(p),
      k: `${p.Categoria} ${p.Marca}`.toLowerCase()
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo leer MegaStoreDB', detalle: e.message });
  }
});

// Envío por código postal
app.get('/api/envio', (req, res) => {
  const r = calcularEnvio(req.query.cp);
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

// Crear pedido: valida, recalcula precios y envío en el servidor, cobra (sandbox) y guarda.
app.post('/api/pedidos', async (req, res) => {
  try {
    const { usuario, direccion, referencias, cp, items, tarjeta } = req.body || {};
    const nombre = String(usuario?.nombre || '').trim();
    const correo = String(usuario?.correo || '').trim().toLowerCase();
    if (!nombre || !/^\S+@\S+\.\S+$/.test(correo)) return res.status(400).json({ error: 'Usuario no válido. Inicia sesión.' });
    if (!String(direccion || '').trim() || !String(referencias || '').trim()) return res.status(400).json({ error: 'Completa la dirección y las referencias.' });
    if (!Array.isArray(items) || !items.length || items.length > 100) return res.status(400).json({ error: 'El carrito está vacío.' });

    const envio = calcularEnvio(cp);
    if (envio.error) return res.status(400).json({ error: envio.error });

    // Normaliza y valida partidas
    const partidas = items.map(i => ({
      id: parseInt(i.idDb, 10), cantidad: parseInt(i.cantidad, 10),
      color: String(i.color || 'Único').slice(0, 50)
    }));
    if (partidas.some(p => !Number.isInteger(p.id) || p.id < 1 || !Number.isInteger(p.cantidad) || p.cantidad < 1 || p.cantidad > 99)) {
      return res.status(400).json({ error: 'Hay productos o cantidades no válidas en el carrito.' });
    }

    const pool = await getPool();
    const ids = [...new Set(partidas.map(p => p.id))];
    const rq = pool.request();
    ids.forEach((id, k) => rq.input('idProd' + k, sql.Int, id));
    const { recordset } = await rq.query(`SELECT Id, Titulo, Precio FROM Productos WHERE Id IN (${ids.map((_, k) => '@idProd' + k).join(',')})`);
    const catalogo = Object.fromEntries(recordset.map(p => [p.Id, p]));
    if (ids.some(id => !catalogo[id])) return res.status(400).json({ error: 'Un producto del carrito ya no existe.' });

    const subtotal = partidas.reduce((s, p) => s + Number(catalogo[p.id].Precio) * p.cantidad, 0);
    const total = subtotal + envio.costo;

    // Cobro sandbox ANTES de guardar; si se rechaza no se crea pedido
    const pago = procesarPago(tarjeta || {}, total);
    if (!pago.aprobado) return res.status(402).json({ error: pago.motivo, pagoRechazado: true });

    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const ped = await new sql.Request(tx)
        .input('nombre', sql.NVarChar(100), nombre.slice(0, 100))
        .input('correo', sql.NVarChar(150), correo.slice(0, 150))
        .input('dir', sql.NVarChar(300), String(direccion).trim().slice(0, 300))
        .input('ref', sql.NVarChar(500), String(referencias).trim().slice(0, 500))
        .input('cp', sql.Char(5), envio.cp)
        .input('est', sql.NVarChar(50), envio.estado)
        .input('km', sql.Int, envio.distanciaKm)
        .input('sub', sql.Decimal(10, 2), subtotal)
        .input('env', sql.Decimal(10, 2), envio.costo)
        .input('tot', sql.Decimal(10, 2), total)
        .input('met', sql.NVarChar(50), `Tarjeta ${pago.marca} (sandbox)`)
        .input('ref2', sql.NVarChar(60), pago.referencia)
        .input('u4', sql.Char(4), pago.ultimos4)
        .query(`INSERT INTO Pedidos (ClienteNombre, ClienteCorreo, Direccion, Referencias, CodigoPostal, EstadoEnvio, DistanciaKm,
                                     Subtotal, CostoEnvio, Total, Estado, MetodoPago, PagoReferencia, TarjetaUltimos4)
                OUTPUT INSERTED.Id, INSERTED.Folio, INSERTED.Fecha
                VALUES (@nombre, @correo, @dir, @ref, @cp, @est, @km, @sub, @env, @tot, 'Pagado', @met, @ref2, @u4)`);
      const { Id, Folio, Fecha } = ped.recordset[0];

      for (const p of partidas) {
        await new sql.Request(tx)
          .input('pid', sql.Int, Id).input('prod', sql.Int, p.id)
          .input('tit', sql.NVarChar(300), catalogo[p.id].Titulo).input('col', sql.NVarChar(50), p.color)
          .input('cant', sql.Int, p.cantidad).input('pre', sql.Decimal(10, 2), catalogo[p.id].Precio)
          .query('INSERT INTO DetallePedido (PedidoId, ProductoId, Producto, Color, Cantidad, PrecioUnitario) VALUES (@pid,@prod,@tit,@col,@cant,@pre)');
      }
      await tx.commit();
      notificarPedido(pool, Id).catch(e => console.error('Correo no registrado:', e.message)); // no bloquea la compra
      res.status(201).json({ folio: Folio, estado: 'Pagado', fecha: Fecha, subtotal, costoEnvio: envio.costo, total, estadoEnvio: envio.estado, pagoReferencia: pago.referencia });
    } catch (e) { await tx.rollback(); throw e; }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo registrar el pedido.', detalle: e.message });
  }
});

// Pedidos de un cliente (con su detalle)
app.get('/api/pedidos', async (req, res) => {
  try {
    const correo = String(req.query.correo || '').trim().toLowerCase();
    if (!correo) return res.status(400).json({ error: 'Falta el correo.' });
    const pool = await getPool();
    const peds = await pool.request().input('c', sql.NVarChar(150), correo)
      .query('SELECT Id, Folio, Estado, Fecha, Subtotal, CostoEnvio, Total, CodigoPostal, EstadoEnvio, MetodoPago FROM Pedidos WHERE ClienteCorreo=@c ORDER BY Fecha DESC');
    const det = await pool.request().input('c', sql.NVarChar(150), correo)
      .query('SELECT d.PedidoId, d.Producto, d.Color, d.Cantidad, d.PrecioUnitario FROM DetallePedido d JOIN Pedidos p ON p.Id=d.PedidoId WHERE p.ClienteCorreo=@c');
    res.json(peds.recordset.map(p => ({ ...p, items: det.recordset.filter(d => d.PedidoId === p.Id) })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudieron leer los pedidos.', detalle: e.message });
  }
});

// Correo de estado del pedido: se envía por SMTP si admin.config.json tiene la sección "smtp"; si no, se simula.
// En ambos casos queda registrado en la tabla CorreosPedido. Se dispara al pagar (Pagado) y en cada cambio de estado.
// `ctx` puede ser el pool o una transacción abierta.
const nuevaPeticion = ctx => ctx instanceof sql.Transaction ? new sql.Request(ctx) : ctx.request();
async function notificarPedido(ctx, pedidoId) {
  const p = (await nuevaPeticion(ctx).input('id', sql.Int, pedidoId).query('SELECT * FROM Pedidos WHERE Id=@id')).recordset[0];
  const items = (await nuevaPeticion(ctx).input('id', sql.Int, pedidoId).query('SELECT * FROM DetallePedido WHERE PedidoId=@id')).recordset;
  const c = construirCorreo(p, items);
  // Envío real por SMTP si está configurado; si no, se simula. Nunca lanza.
  const r = await enviarCorreo({ para: p.ClienteCorreo, asunto: c.asunto, texto: c.texto, html: c.html });
  await nuevaPeticion(ctx)
    .input('id', sql.Int, pedidoId).input('para', sql.NVarChar(150), p.ClienteCorreo)
    .input('asunto', sql.NVarChar(200), c.asunto).input('cuerpo', sql.NVarChar(sql.MAX), c.texto)
    .input('res', sql.NVarChar(20), r.resultado).input('det', sql.NVarChar(300), r.detalle)
    .query('INSERT INTO CorreosPedido (PedidoId, Para, Asunto, Cuerpo, Resultado, Detalle) VALUES (@id,@para,@asunto,@cuerpo,@res,@det)');
}

// ---------- Panel admin (requiere cabecera x-admin-key) ----------
const NO_CANCELADO = "Estado <> 'Cancelado'";

app.get('/api/admin/kpis', requiereAdmin, async (req, res) => {
  try {
    const pool = await getPool(), q = t => pool.request().query(t).then(r => r.recordset);
    const [tot] = await q(`SELECT ISNULL(SUM(Total),0) AS ventas, COUNT(*) AS pedidos, ISNULL(SUM(CostoEnvio),0) AS envios FROM Pedidos WHERE ${NO_CANCELADO}`);
    const [top] = await q(`SELECT TOP 1 d.Producto, SUM(d.Cantidad) AS unidades FROM DetallePedido d JOIN Pedidos p ON p.Id=d.PedidoId
                           WHERE p.Estado <> 'Cancelado' GROUP BY d.ProductoId, d.Producto ORDER BY SUM(d.Cantidad) DESC, d.Producto`);
    const porCategoria = await q(`SELECT pr.Categoria AS categoria, SUM(d.Cantidad*d.PrecioUnitario) AS ventas, SUM(d.Cantidad) AS unidades
                           FROM DetallePedido d JOIN Pedidos p ON p.Id=d.PedidoId JOIN Productos pr ON pr.Id=d.ProductoId
                           WHERE p.Estado <> 'Cancelado' GROUP BY pr.Categoria ORDER BY ventas DESC`);
    const porEstado = await q('SELECT Estado AS estado, COUNT(*) AS pedidos FROM Pedidos GROUP BY Estado');
    const porDia = await q(`SELECT CONVERT(varchar(10), CAST(Fecha AS DATE), 23) AS dia, SUM(Total) AS ventas, COUNT(*) AS pedidos FROM Pedidos
                           WHERE ${NO_CANCELADO} AND Fecha >= DATEADD(DAY,-29,CAST(SYSDATETIME() AS DATE))
                           GROUP BY CAST(Fecha AS DATE) ORDER BY CAST(Fecha AS DATE)`);
    const pendientes = porEstado.find(e => e.estado === 'Pagado')?.pedidos || 0;
    res.json({
      ventasTotales: Number(tot.ventas), pedidos: tot.pedidos,
      ticketPromedio: tot.pedidos ? Number(tot.ventas) / tot.pedidos : 0,
      ingresoEnvios: Number(tot.envios),
      productoTop: top ? { nombre: top.Producto, unidades: top.unidades } : null,
      porEnviar: pendientes,
      porCategoria: porCategoria.map(c => ({ ...c, ventas: Number(c.ventas) })),
      porEstado, porDia: porDia.map(d => ({ ...d, ventas: Number(d.ventas) }))
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudieron calcular los KPIs.', detalle: e.message }); }
});

app.get('/api/admin/pedidos', requiereAdmin, async (req, res) => {
  try {
    const pool = await getPool();
    const peds = (await pool.request().query('SELECT TOP 200 * FROM Pedidos ORDER BY Fecha DESC')).recordset;
    const det = (await pool.request().query('SELECT PedidoId, Producto, Color, Cantidad, PrecioUnitario FROM DetallePedido')).recordset;
    const correos = (await pool.request().query('SELECT PedidoId, Para, Asunto, Resultado, Fecha FROM CorreosPedido ORDER BY Fecha DESC')).recordset;
    res.json(peds.map(p => ({
      folio: p.Folio, estado: p.Estado, fecha: p.Fecha, cliente: p.ClienteNombre, correo: p.ClienteCorreo, direccion: p.Direccion,
      cp: p.CodigoPostal, estadoEnvio: p.EstadoEnvio, subtotal: Number(p.Subtotal), envio: Number(p.CostoEnvio), total: Number(p.Total),
      items: det.filter(d => d.PedidoId === p.Id).map(d => ({ producto: d.Producto, color: d.Color, cantidad: d.Cantidad, precio: Number(d.PrecioUnitario) })),
      correos: correos.filter(c => c.PedidoId === p.Id).map(c => ({ asunto: c.Asunto, resultado: c.Resultado, fecha: c.Fecha }))
    })));
  } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudieron leer los pedidos.', detalle: e.message }); }
});

// Flujo permitido de estados
const TRANSICIONES = { Pendiente: ['Pagado', 'Cancelado'], Pagado: ['Enviado', 'Cancelado'], Enviado: ['Entregado', 'Cancelado'], Entregado: [], Cancelado: [] };
app.post('/api/admin/pedidos/:folio/estado', requiereAdmin, cambiarEstado);
app.patch('/api/admin/pedidos/:folio/estado', requiereAdmin, cambiarEstado);
async function cambiarEstado(req, res) {
  try {
    const nuevo = String(req.body?.estado || '');
    if (!ESTADOS_VALIDOS.includes(nuevo)) return res.status(400).json({ error: 'Estado no válido.' });
    const pool = await getPool();
    const p = (await pool.request().input('f', sql.NVarChar(20), req.params.folio).query('SELECT Id, Estado FROM Pedidos WHERE Folio=@f')).recordset[0];
    if (!p) return res.status(404).json({ error: 'Pedido no encontrado.' });
    if (!(TRANSICIONES[p.Estado] || []).includes(nuevo)) return res.status(409).json({ error: `No se puede pasar de "${p.Estado}" a "${nuevo}".` });
    // Estado + correo en una sola transacción: o se hacen los dos o ninguno
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx).input('id', sql.Int, p.Id).input('e', sql.NVarChar(20), nuevo).query('UPDATE Pedidos SET Estado=@e WHERE Id=@id');
      await notificarPedido(tx, p.Id);
      await tx.commit();
    } catch (err) { await tx.rollback(); throw err; }
    res.json({ folio: req.params.folio, estado: nuevo, correo: 'registrado' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo actualizar el estado.', detalle: e.message }); }
}

// ---------- Reseñas ----------
// Resumen por producto: { "<idDb>": { n, promedio } }
app.get('/api/resenas/resumen', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query('SELECT ProductoId, COUNT(*) AS n, AVG(CAST(Calificacion AS FLOAT)) AS promedio FROM Resenas GROUP BY ProductoId');
    res.json(Object.fromEntries(r.recordset.map(x => [x.ProductoId, { n: x.n, promedio: Math.round(x.promedio * 10) / 10 }])));
  } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudieron leer las reseñas.', detalle: e.message }); }
});

app.get('/api/resenas', async (req, res) => {
  try {
    const id = parseInt(req.query.producto, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Producto no válido.' });
    const pool = await getPool();
    const r = await pool.request().input('p', sql.Int, id)
      .query('SELECT ClienteNombre, Calificacion, Comentario, Fecha FROM Resenas WHERE ProductoId=@p ORDER BY Fecha DESC, Id DESC');
    // No se expone el correo del autor
    res.json(r.recordset.map(x => ({ usuario: x.ClienteNombre, calificacion: x.Calificacion, comentario: x.Comentario, fecha: x.Fecha })));
  } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudieron leer las reseñas.', detalle: e.message }); }
});

app.post('/api/resenas', async (req, res) => {
  try {
    const { usuario, producto, calificacion, comentario } = req.body || {};
    const nombre = String(usuario?.nombre || '').trim(), correo = String(usuario?.correo || '').trim().toLowerCase();
    const id = parseInt(producto, 10), estrellas = parseInt(calificacion, 10), texto = String(comentario || '').trim();
    if (!nombre || !/^\S+@\S+\.\S+$/.test(correo)) return res.status(400).json({ error: 'Inicia sesión para publicar una reseña.' });
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Producto no válido.' });
    if (!(estrellas >= 1 && estrellas <= 5)) return res.status(400).json({ error: 'La calificación debe ser de 1 a 5.' });
    if (!texto || texto.length > 500) return res.status(400).json({ error: 'El comentario debe tener entre 1 y 500 caracteres.' });

    const pool = await getPool();
    const existe = await pool.request().input('p', sql.Int, id).query('SELECT 1 AS ok FROM Productos WHERE Id=@p');
    if (!existe.recordset.length) return res.status(404).json({ error: 'El producto no existe.' });
    try {
      await pool.request().input('p', sql.Int, id).input('n', sql.NVarChar(100), nombre.slice(0, 100)).input('c', sql.NVarChar(150), correo.slice(0, 150))
        .input('e', sql.TinyInt, estrellas).input('t', sql.NVarChar(500), texto)
        .query('INSERT INTO Resenas (ProductoId, ClienteNombre, ClienteCorreo, Calificacion, Comentario) VALUES (@p,@n,@c,@e,@t)');
    } catch (err) {
      if (err.number === 2627 || err.number === 2601 || /UQ_Resenas_UnaPorCliente/.test(err.message)) {
        return res.status(409).json({ error: 'Ya publicaste una reseña de este producto.' });
      }
      throw err;
    }
    res.status(201).json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'No se pudo publicar la reseña.', detalle: e.message }); }
});

app.get('/admin', (req, res) => res.sendFile(__dirname + '/admin.html'));

// Anuncios activos: banners y productos patrocinados
app.get('/api/anuncios', async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(
      'SELECT Id, Tipo, Titulo, Texto, Boton, Categoria, Tema, ProductoId FROM Anuncios WHERE Activo = 1 ORDER BY Orden, Id');
    res.json({
      banners: r.recordset.filter(a => a.Tipo === 'banner').map(a => ({
        id: a.Id, titulo: a.Titulo, texto: a.Texto, boton: a.Boton, categoria: a.Categoria, tema: a.Tema
      })),
      productos: r.recordset.filter(a => a.Tipo === 'producto' && a.ProductoId).map(a => a.ProductoId)
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudieron leer los anuncios.', detalle: e.message });
  }
});

app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

app.listen(3000, () => {
  console.log('Tienda en http://localhost:3000');
  // MegaStoreDB tiene AUTO_CLOSE: la primera consulta tarda varios segundos en reabrirla.
  // Conectar al arrancar y mantener el pool abierto evita esa espera al primer visitante.
  getPool()
    .then(pool => pool.request().query('SELECT COUNT(*) AS n FROM Productos'))
    .then(r => console.log(`Base de datos lista (${r.recordset[0].n} productos)`))
    .catch(e => console.error('No se pudo conectar a SQL Server:', e.message));
});
