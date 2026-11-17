// API de LocalStorage en Cloudflare Pages Functions + Supabase (reemplaza a server.js).
// Todas las rutas /api/... entran por aquí. Variables de entorno (Cloudflare → Settings → Variables and Secrets):
//   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY (secreto), ORIGEN_ESTADO,
//   EMAIL_API_KEY (secreto, opcional), EMAIL_FROM (opcional)
import { calcularEnvio } from '../_lib/envio.js';
import { procesarPago } from '../_lib/pagos.js';
import { construirCorreo, enviarCorreo, ESTADOS_VALIDOS } from '../_lib/correo.js';
import { db, rpc, usuarioDeSolicitud, ErrorDB } from '../_lib/supabase.js';

const json = (datos, status = 200) => new Response(JSON.stringify(datos), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
});
const error = (status, mensaje, extra = {}) => json({ error: mensaje, ...extra }, status);

// ---------- Imágenes por categoría (igual que server.js) ----------
const U = id => `https://images.unsplash.com/${id}?w=400`;
const IMAGENES_POR_CATEGORIA = {
  'Teléfonos': ['photo-1511707171634-5f897ff02aa9', 'photo-1598327105666-5b89351aff97'].map(U),
  'Televisores': ['photo-1593359677879-a4bb92f829d1', 'photo-1461151304267-38535e780c79', 'photo-1552975084-6e027cd345c2'].map(U),
  'Electrodomésticos': ['photo-1626806787461-102c1bfaaea1', 'photo-1574269909862-7e1d70bb8078', 'photo-1571175443880-49e1d25b2bc5', 'photo-1588854337221-4cf9fa96059c'].map(U),
  'Cómputo': ['photo-1496181133206-80ce9b88a853', 'photo-1517336714731-489689fd1ca8', 'photo-1525547719571-a2d4ac8945e2'].map(U),
  'Audio': ['photo-1505740420928-5e560c06d30e', 'photo-1546435770-a3e426bf472b', 'photo-1583394838336-acd977736f90', 'photo-1608043152269-423dbba4e7e1', 'photo-1572569511254-d8f925fe2cbb'].map(U),
  'Hogar y cocina': ['photo-1556911220-e15b29be8c8f', 'photo-1570222094114-d054a817e56b', 'photo-1585515320310-259814833e62'].map(U)
};

// ---------- Rutas públicas ----------
async function productos(env) {
  const filas = await db(env, 'productos?select=id,titulo,categoria,marca,precio,caracteristicas,colores,imagen&order=id.asc&limit=1000');
  const contador = {};
  return json(filas.map(p => {
    const pool = IMAGENES_POR_CATEGORIA[p.categoria];
    let img = p.imagen;
    if (pool) { const n = contador[p.categoria] = (contador[p.categoria] ?? -1) + 1; img = pool[n % pool.length]; }
    return {
      id: p.id - 1, idDb: p.id, t: p.titulo, n: p.titulo, c: p.categoria, m: p.marca, p: Number(p.precio),
      f: p.caracteristicas.split('|').map(s => s.trim()).filter(Boolean),
      colores: p.colores.split(',').map(s => s.trim()).filter(Boolean),
      img, k: `${p.categoria} ${p.marca}`.toLowerCase()
    };
  }));
}

async function anuncios(env) {
  const filas = await db(env, 'anuncios?select=id,tipo,titulo,texto,boton,categoria,tema,producto_id&activo=eq.true&order=orden.asc,id.asc');
  return json({
    banners: filas.filter(a => a.tipo === 'banner').map(a => ({ id: a.id, titulo: a.titulo, texto: a.texto, boton: a.boton, categoria: a.categoria, tema: a.tema })),
    productos: filas.filter(a => a.tipo === 'producto' && a.producto_id).map(a => a.producto_id)
  });
}

// ---------- Pedidos ----------
async function notificarPedido(env, pedidoId) {
  const [p] = await db(env, `pedidos?id=eq.${pedidoId}&select=*`);
  const items = await db(env, `detalle_pedido?pedido_id=eq.${pedidoId}&select=producto,color,cantidad,precio_unitario&order=id.asc`);
  const c = construirCorreo(p, items);
  const r = await enviarCorreo(env, { para: p.cliente_correo, asunto: c.asunto, texto: c.texto, html: c.html });
  await db(env, 'correos_pedido', {
    metodo: 'POST', prefer: 'return=minimal',
    cuerpo: { pedido_id: pedidoId, para: p.cliente_correo, asunto: c.asunto, cuerpo: c.texto, resultado: r.resultado, detalle: r.detalle?.slice(0, 300) ?? null }
  });
}

async function crearPedido(env, request, ctx, usuario) {
  const b = await request.json().catch(() => ({}));
  const { direccion, referencias, cp, items, tarjeta } = b;
  if (!String(direccion || '').trim() || !String(referencias || '').trim()) return error(400, 'Completa la dirección y las referencias.');
  if (!Array.isArray(items) || !items.length || items.length > 100) return error(400, 'El carrito está vacío.');

  const envio = calcularEnvio(cp, env.ORIGEN_ESTADO);
  if (envio.error) return error(400, envio.error);

  const partidas = items.map(i => ({ id: parseInt(i.idDb, 10), cantidad: parseInt(i.cantidad, 10), color: String(i.color || 'Único').slice(0, 50) }));
  if (partidas.some(p => !Number.isInteger(p.id) || p.id < 1 || !Number.isInteger(p.cantidad) || p.cantidad < 1 || p.cantidad > 99)) {
    return error(400, 'Hay productos o cantidades no válidas en el carrito.');
  }

  // Precios SIEMPRE desde la base (el navegador solo manda ids y cantidades)
  const ids = [...new Set(partidas.map(p => p.id))];
  const cat = await db(env, `productos?id=in.(${ids.join(',')})&select=id,precio`);
  const precios = Object.fromEntries(cat.map(p => [p.id, Number(p.precio)]));
  if (ids.some(id => precios[id] === undefined)) return error(400, 'Un producto del carrito ya no existe.');
  const total = partidas.reduce((s, p) => s + precios[p.id] * p.cantidad, 0) + envio.costo;

  // Cobro sandbox ANTES de guardar; si se rechaza no se crea pedido
  const pago = procesarPago(tarjeta || {}, total);
  if (!pago.aprobado) return error(402, pago.motivo, { pagoRechazado: true });

  let ped;
  try {
    ped = await rpc(env, 'crear_pedido', { p: {
      usuario_id: usuario.id, nombre: usuario.nombre, correo: usuario.correo,
      direccion: String(direccion).trim().slice(0, 300), referencias: String(referencias).trim().slice(0, 500),
      cp: envio.cp, estado_envio: envio.estado, distancia_km: envio.distanciaKm, costo_envio: envio.costo,
      metodo_pago: `Tarjeta ${pago.marca} (sandbox)`, pago_referencia: pago.referencia, ultimos4: pago.ultimos4, items: partidas
    } });
  } catch (e) {
    if (e instanceof ErrorDB && /producto_inexistente|carrito_vacio/.test(e.message)) return error(400, 'Un producto del carrito ya no existe.');
    throw e;
  }
  // El correo no bloquea la compra
  ctx.waitUntil(notificarPedido(env, ped.id).catch(e => console.error('Correo no registrado:', e.message)));
  return json({ folio: ped.folio, estado: 'Pagado', fecha: ped.creado_en, subtotal: ped.subtotal, costoEnvio: ped.costo_envio,
                total: ped.total, estadoEnvio: envio.estado, pagoReferencia: pago.referencia }, 201);
}

async function misPedidos(env, usuario) {
  const filas = await db(env, `pedidos?usuario_id=eq.${usuario.id}&select=id,folio,estado,creado_en,subtotal,costo_envio,total,codigo_postal,estado_envio,metodo_pago,detalle_pedido(producto,color,cantidad,precio_unitario)&order=creado_en.desc`);
  // Mismo formato que devolvía el servidor local (lo que espera index.html)
  return json(filas.map(p => ({
    Folio: p.folio, Estado: p.estado, Fecha: p.creado_en, Subtotal: p.subtotal, CostoEnvio: p.costo_envio, Total: p.total,
    CodigoPostal: p.codigo_postal, EstadoEnvio: p.estado_envio, MetodoPago: p.metodo_pago,
    items: p.detalle_pedido.map(d => ({ Producto: d.producto, Color: d.color, Cantidad: d.cantidad, PrecioUnitario: d.precio_unitario }))
  })));
}

// ---------- Reseñas ----------
async function listaResenas(env, url) {
  const id = parseInt(url.searchParams.get('producto'), 10);
  if (!Number.isInteger(id) || id < 1) return error(400, 'Producto no válido.');
  const filas = await db(env, `resenas?producto_id=eq.${id}&select=cliente_nombre,calificacion,comentario,creado_en&order=creado_en.desc,id.desc`);
  return json(filas.map(x => ({ usuario: x.cliente_nombre, calificacion: x.calificacion, comentario: x.comentario, fecha: x.creado_en })));
}

async function publicarResena(env, request, usuario) {
  const b = await request.json().catch(() => ({}));
  const id = parseInt(b.producto, 10), estrellas = parseInt(b.calificacion, 10), texto = String(b.comentario || '').trim();
  if (!Number.isInteger(id) || id < 1) return error(400, 'Producto no válido.');
  if (!(estrellas >= 1 && estrellas <= 5)) return error(400, 'La calificación debe ser de 1 a 5.');
  if (!texto || texto.length > 500) return error(400, 'El comentario debe tener entre 1 y 500 caracteres.');
  try {
    await db(env, 'resenas', { metodo: 'POST', prefer: 'return=minimal',
      cuerpo: { producto_id: id, usuario_id: usuario.id, cliente_nombre: usuario.nombre, calificacion: estrellas, comentario: texto } });
  } catch (e) {
    if (e instanceof ErrorDB && e.codigo === '23505') return error(409, 'Ya publicaste una reseña de este producto.');
    if (e instanceof ErrorDB && e.codigo === '23503') return error(404, 'El producto no existe.');
    throw e;
  }
  return json({ ok: true }, 201);
}

// ---------- Panel admin (usuario con app_metadata.rol = "admin") ----------
async function adminPedidos(env) {
  const filas = await db(env, 'pedidos?select=*,detalle_pedido(producto,color,cantidad,precio_unitario),correos_pedido(asunto,resultado,creado_en)&order=creado_en.desc&limit=200');
  return json(filas.map(p => ({
    folio: p.folio, estado: p.estado, fecha: p.creado_en, cliente: p.cliente_nombre, correo: p.cliente_correo, direccion: p.direccion,
    cp: p.codigo_postal, estadoEnvio: p.estado_envio, subtotal: Number(p.subtotal), envio: Number(p.costo_envio), total: Number(p.total),
    items: p.detalle_pedido.map(d => ({ producto: d.producto, color: d.color, cantidad: d.cantidad, precio: Number(d.precio_unitario) })),
    correos: p.correos_pedido.sort((a, b) => b.creado_en.localeCompare(a.creado_en)).map(c => ({ asunto: c.asunto, resultado: c.resultado, fecha: c.creado_en }))
  })));
}

async function cambiarEstado(env, request, folio) {
  const b = await request.json().catch(() => ({}));
  const nuevo = String(b.estado || '');
  if (!ESTADOS_VALIDOS.includes(nuevo)) return error(400, 'Estado no válido.');
  let r;
  try {
    r = await rpc(env, 'cambiar_estado_pedido', { p_folio: folio, p_estado: nuevo });
  } catch (e) {
    if (e instanceof ErrorDB && e.codigo === 'P0002') return error(404, 'Pedido no encontrado.');
    const m = e instanceof ErrorDB && /^transicion_invalida:(.*):(.*)$/.exec(e.message);
    if (m) return error(409, `No se puede pasar de "${m[1]}" a "${m[2]}".`);
    throw e;
  }
  let correo = 'registrado';
  try { await notificarPedido(env, r.id); } catch (e) { console.error('Correo no registrado:', e.message); correo = 'no registrado'; }
  return json({ folio, estado: nuevo, correo });
}

// ---------- Enrutador ----------
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const ruta = url.pathname.replace(/\/+$/, '');
  const m = request.method;

  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.SUPABASE_SECRET_KEY) {
    return error(500, 'Faltan variables de entorno de Supabase en Cloudflare.');
  }

  try {
    // Públicas
    if (m === 'GET' && ruta === '/api/config') return json({ supabaseUrl: env.SUPABASE_URL, supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY });
    if (m === 'GET' && ruta === '/api/productos') return await productos(env);
    if (m === 'GET' && ruta === '/api/anuncios') return await anuncios(env);
    if (m === 'GET' && ruta === '/api/envio') {
      const r = calcularEnvio(url.searchParams.get('cp'), env.ORIGEN_ESTADO);
      return r.error ? json(r, 400) : json(r);
    }
    if (m === 'GET' && ruta === '/api/resenas/resumen') return json(await rpc(env, 'resumen_resenas'));
    if (m === 'GET' && ruta === '/api/resenas') return await listaResenas(env, url);

    // Con sesión
    const requiereSesion = ['/api/pedidos', '/api/resenas'].includes(ruta) && m === 'POST' || (ruta === '/api/pedidos' && m === 'GET');
    const esAdmin = ruta.startsWith('/api/admin/');
    if (requiereSesion || esAdmin) {
      const usuario = await usuarioDeSolicitud(env, request);
      if (!usuario) return error(401, esAdmin ? 'Inicia sesión como administrador.' : 'Inicia sesión para continuar.');
      if (esAdmin) {
        if (usuario.rol !== 'admin') return error(403, 'Tu cuenta no tiene permisos de administrador.');
        if (m === 'GET' && ruta === '/api/admin/kpis') return json(await rpc(env, 'kpis_admin'));
        if (m === 'GET' && ruta === '/api/admin/pedidos') return await adminPedidos(env);
        const est = /^\/api\/admin\/pedidos\/([^/]+)\/estado$/.exec(ruta);
        if (est && (m === 'POST' || m === 'PATCH')) return await cambiarEstado(env, request, decodeURIComponent(est[1]));
      } else {
        if (ruta === '/api/pedidos' && m === 'POST') return await crearPedido(env, request, context, usuario);
        if (ruta === '/api/pedidos' && m === 'GET') return await misPedidos(env, usuario);
        if (ruta === '/api/resenas' && m === 'POST') return await publicarResena(env, request, usuario);
      }
    }
    return error(404, 'Ruta no encontrada.');
  } catch (e) {
    console.error(e);
    return error(500, 'Error del servidor.', { detalle: e.message });
  }
}
