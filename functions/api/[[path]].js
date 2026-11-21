// API de LocalStorage en Cloudflare Pages Functions + Supabase (reemplaza a server.js).
// Todas las rutas /api/... entran por aquí. Variables de entorno (Cloudflare → Settings → Variables and Secrets):
//   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY (secreto), ORIGEN_ESTADO,
//   BREVO_API_KEY o EMAIL_API_KEY (secreto, para enviar correos), EMAIL_FROM (remitente)
import { calcularEnvio } from '../_lib/envio.js';
import { procesarPago } from '../_lib/pagos.js';
import { construirCorreo, enviarCorreo, ESTADOS_VALIDOS } from '../_lib/correo.js';
import { db, dbTodo, rpc, usuarioDeSolicitud, ErrorDB, faltaFuncion } from '../_lib/supabase.js';

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
  const cat = await db(env, `productos?id=in.(${ids.join(',')})&select=id,precio,titulo`);
  const precios = Object.fromEntries(cat.map(p => [p.id, Number(p.precio)]));
  const titulos = Object.fromEntries(cat.map(p => [p.id, p.titulo]));
  if (ids.some(id => precios[id] === undefined)) return error(400, 'Un producto del carrito ya no existe.');
  const total = partidas.reduce((s, p) => s + precios[p.id] * p.cantidad, 0) + envio.costo;

  // Cobro sandbox ANTES de guardar; si se rechaza no se crea pedido
  const pago = procesarPago(tarjeta || {}, total);
  if (!pago.aprobado) return error(402, pago.motivo, { pagoRechazado: true });

  const datos = {
    usuario_id: usuario.id, nombre: usuario.nombre, correo: usuario.correo,
    direccion: String(direccion).trim().slice(0, 300), referencias: String(referencias).trim().slice(0, 500),
    cp: envio.cp, estado_envio: envio.estado, distancia_km: envio.distanciaKm, costo_envio: envio.costo,
    metodo_pago: `Tarjeta ${pago.marca} (sandbox)`, pago_referencia: pago.referencia, ultimos4: pago.ultimos4, items: partidas
  };
  let ped;
  try {
    ped = await rpc(env, 'crear_pedido', { p: datos });
  } catch (e) {
    if (e instanceof ErrorDB && /producto_inexistente|carrito_vacio/.test(e.message)) return error(400, 'Un producto del carrito ya no existe.');
    if (!faltaFuncion(e)) throw e;
    ped = await crearPedidoDirecto(env, datos, precios, titulos);   // la función SQL no existe: se guarda por la API REST
  }
  // El correo no bloquea la compra
  ctx.waitUntil(notificarPedido(env, ped.id).catch(e => console.error('Correo no registrado:', e.message)));
  return json({ folio: ped.folio, estado: 'Pagado', fecha: ped.creado_en, subtotal: ped.subtotal, costoEnvio: ped.costo_envio,
                total: ped.total, estadoEnvio: envio.estado, pagoReferencia: pago.referencia, correo: usuario.correo }, 201);
}

// Respaldo si en Supabase no existe la función crear_pedido(): pedido + detalle por REST (si falla el detalle, se borra el pedido)
async function crearPedidoDirecto(env, d, precios, titulos) {
  const subtotal = d.items.reduce((s, i) => s + precios[i.id] * i.cantidad, 0);
  const [ped] = await db(env, 'pedidos?select=id,folio,creado_en,subtotal,costo_envio,total', {
    metodo: 'POST', prefer: 'return=representation',
    cuerpo: {
      usuario_id: d.usuario_id, cliente_nombre: d.nombre, cliente_correo: d.correo, direccion: d.direccion, referencias: d.referencias,
      codigo_postal: d.cp, estado_envio: d.estado_envio, distancia_km: d.distancia_km, subtotal, costo_envio: d.costo_envio,
      total: subtotal + d.costo_envio, estado: 'Pagado', metodo_pago: d.metodo_pago, pago_referencia: d.pago_referencia, tarjeta_ultimos4: d.ultimos4
    }
  });
  try {
    await db(env, 'detalle_pedido', { metodo: 'POST', prefer: 'return=minimal',
      cuerpo: d.items.map(i => ({ pedido_id: ped.id, producto_id: i.id, producto: titulos[i.id], color: i.color, cantidad: i.cantidad, precio_unitario: precios[i.id] })) });
  } catch (e) {
    await db(env, `pedidos?id=eq.${ped.id}`, { metodo: 'DELETE' }).catch(() => {});
    throw e;
  }
  return ped;
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

// Cancelación por el cliente: solo su propio pedido y solo mientras siga "Pagado" (aún no enviado)
async function cancelarMiPedido(env, folio, usuario) {
  const [p] = await db(env, `pedidos?folio=eq.${encodeURIComponent(folio)}&usuario_id=eq.${usuario.id}&select=id,estado`);
  if (!p) return error(404, 'No encontramos ese pedido en tu cuenta.');
  if (p.estado === 'Cancelado') return error(409, 'Este pedido ya estaba cancelado.');
  if (p.estado !== 'Pagado') return error(409, `Tu pedido ya está "${p.estado}", por eso ya no se puede cancelar.`);
  // El filtro estado=eq.Pagado evita cancelar si el administrador lo envió en ese mismo instante
  const act = await db(env, `pedidos?id=eq.${p.id}&estado=eq.Pagado&select=id`, { metodo: 'PATCH', prefer: 'return=representation', cuerpo: { estado: 'Cancelado' } });
  if (!act.length) return error(409, 'Tu pedido acaba de cambiar de estado y ya no se puede cancelar. Revisa "Mis pedidos".');
  let correo = 'registrado';
  try { await notificarPedido(env, p.id); } catch (e) { console.error('Correo no registrado:', e.message); correo = 'no registrado'; }
  return json({ folio, estado: 'Cancelado', correo });
}

// ---------- Reseñas ----------
async function resumenResenas(env) {
  try { return json(await rpc(env, 'resumen_resenas')); }
  catch (e) {
    if (!faltaFuncion(e)) throw e;
    const filas = await dbTodo(env, 'resenas?select=producto_id,calificacion&order=id.asc');
    const r = {};
    for (const x of filas) { const a = r[x.producto_id] ||= { s: 0, n: 0 }; a.s += x.calificacion; a.n++; }
    return json(Object.fromEntries(Object.entries(r).map(([id, a]) => [id, { n: a.n, promedio: Math.round(a.s / a.n * 10) / 10 }])));
  }
}
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
// KPIs calculados aquí con los datos de Supabase (no depende de funciones SQL). Fechas en hora de la Ciudad de México.
const diaMx = f => new Date(f).toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });   // "2026-11-21"
async function kpisAdmin(env) {
  const [pedidos, detalle, correos] = await Promise.all([
    dbTodo(env, 'pedidos?select=id,estado,total,costo_envio,creado_en,usuario_id&order=id.asc'),
    dbTodo(env, 'detalle_pedido?select=pedido_id,producto_id,producto,cantidad,precio_unitario,productos(categoria)&order=id.asc'),
    dbTodo(env, 'correos_pedido?select=resultado&order=id.asc')
  ]);
  const validos = pedidos.filter(p => p.estado !== 'Cancelado');
  const idsValidos = new Set(validos.map(p => p.id));
  const det = detalle.filter(d => idsValidos.has(d.pedido_id));
  const suma = (arr, f) => arr.reduce((s, x) => s + Number(f(x) || 0), 0);

  const ventasTotales = suma(validos, p => p.total);
  const hoy = diaMx(new Date()), mes = hoy.slice(0, 7);
  const ant = new Date(hoy + 'T12:00:00Z'); ant.setUTCDate(1); ant.setUTCMonth(ant.getUTCMonth() - 1);
  const mesAnterior = ant.toISOString().slice(0, 7);
  const deDia = validos.map(p => ({ ...p, dia: diaMx(p.creado_en) }));
  const ventasMes = suma(deDia.filter(p => p.dia.startsWith(mes)), p => p.total);
  const ventasMesAnterior = suma(deDia.filter(p => p.dia.startsWith(mesAnterior)), p => p.total);

  const porProducto = {}, porCat = {};
  for (const d of det) {
    const pr = porProducto[d.producto_id] ||= { nombre: d.producto, unidades: 0 }; pr.unidades += d.cantidad;
    const cat = d.productos?.categoria || 'Sin categoría';
    const c = porCat[cat] ||= { categoria: cat, ventas: 0, unidades: 0 };
    c.ventas += d.cantidad * Number(d.precio_unitario); c.unidades += d.cantidad;
  }
  const productoTop = Object.values(porProducto).sort((a, b) => b.unidades - a.unidades || a.nombre.localeCompare(b.nombre, 'es'))[0] || null;

  const porEstado = Object.entries(pedidos.reduce((m, p) => (m[p.estado] = (m[p.estado] || 0) + 1, m), {})).map(([estado, n]) => ({ estado, pedidos: n }));
  const desde = new Date(); desde.setDate(desde.getDate() - 29); const limite = diaMx(desde);
  const dias = {};
  for (const p of deDia) if (p.dia >= limite) { const x = dias[p.dia] ||= { dia: p.dia, ventas: 0, pedidos: 0 }; x.ventas += Number(p.total); x.pedidos++; }
  const correosCuenta = correos.reduce((m, c) => (m[c.resultado] = (m[c.resultado] || 0) + 1, m), {});

  return json({
    ventasTotales, pedidos: validos.length, ticketPromedio: validos.length ? ventasTotales / validos.length : 0,
    ingresoEnvios: suma(validos, p => p.costo_envio),
    productoTop, porEnviar: pedidos.filter(p => p.estado === 'Pagado').length,
    ventasHoy: suma(deDia.filter(p => p.dia === hoy), p => p.total), pedidosHoy: deDia.filter(p => p.dia === hoy).length,
    ventasMes, ventasMesAnterior, variacionMes: ventasMesAnterior ? (ventasMes - ventasMesAnterior) / ventasMesAnterior : null,
    unidades: suma(det, d => d.cantidad), clientes: new Set(validos.map(p => p.usuario_id)).size,
    cancelados: pedidos.length - validos.length,
    correos: { enviados: correosCuenta.Enviado || 0, simulados: correosCuenta.Simulado || 0, errores: correosCuenta.Error || 0 },
    porCategoria: Object.values(porCat).sort((a, b) => b.ventas - a.ventas),
    porEstado, porDia: Object.values(dias).sort((a, b) => a.dia.localeCompare(b.dia))
  });
}

async function adminPedidos(env) {
  const filas = await db(env, 'pedidos?select=*,detalle_pedido(producto,color,cantidad,precio_unitario),correos_pedido(asunto,resultado,creado_en)&order=creado_en.desc&limit=200');
  return json(filas.map(p => ({
    folio: p.folio, estado: p.estado, fecha: p.creado_en, cliente: p.cliente_nombre, correo: p.cliente_correo, direccion: p.direccion,
    cp: p.codigo_postal, estadoEnvio: p.estado_envio, subtotal: Number(p.subtotal), envio: Number(p.costo_envio), total: Number(p.total),
    items: p.detalle_pedido.map(d => ({ producto: d.producto, color: d.color, cantidad: d.cantidad, precio: Number(d.precio_unitario) })),
    correos: p.correos_pedido.sort((a, b) => b.creado_en.localeCompare(a.creado_en)).map(c => ({ asunto: c.asunto, resultado: c.resultado, fecha: c.creado_en }))
  })));
}

const TRANSICIONES = { Pendiente: ['Pagado', 'Cancelado'], Pagado: ['Enviado', 'Cancelado'], Enviado: ['Entregado', 'Cancelado'], Entregado: [], Cancelado: [] };

async function cambiarEstado(env, request, folio) {
  const b = await request.json().catch(() => ({}));
  const nuevo = String(b.estado || '');
  if (!ESTADOS_VALIDOS.includes(nuevo)) return error(400, 'Estado no válido.');
  let r;
  try {
    try {
      r = await rpc(env, 'cambiar_estado_pedido', { p_folio: folio, p_estado: nuevo });
    } catch (e) {
      if (!faltaFuncion(e)) throw e;
      // Respaldo si no existe la función SQL: mismo flujo de estados, por REST
      const [p] = await db(env, `pedidos?folio=eq.${encodeURIComponent(folio)}&select=id,estado`);
      if (!p) return error(404, 'Pedido no encontrado.');
      if (!(TRANSICIONES[p.estado] || []).includes(nuevo)) return error(409, `No se puede pasar de "${p.estado}" a "${nuevo}".`);
      const act = await db(env, `pedidos?id=eq.${p.id}&estado=eq.${encodeURIComponent(p.estado)}&select=id`, { metodo: 'PATCH', prefer: 'return=representation', cuerpo: { estado: nuevo } });
      if (!act.length) return error(409, 'El pedido cambió mientras tanto. Actualiza e inténtalo de nuevo.');
      r = { id: p.id };
    }
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
    if (m === 'GET' && ruta === '/api/resenas/resumen') return await resumenResenas(env);
    if (m === 'GET' && ruta === '/api/resenas') return await listaResenas(env, url);

    // Con sesión
    const cancelar = m === 'POST' && /^\/api\/pedidos\/([^/]+)\/cancelar$/.exec(ruta);
    const requiereSesion = ['/api/pedidos', '/api/resenas'].includes(ruta) && m === 'POST' || (ruta === '/api/pedidos' && m === 'GET') || !!cancelar;
    const esAdmin = ruta.startsWith('/api/admin/');
    if (requiereSesion || esAdmin) {
      const usuario = await usuarioDeSolicitud(env, request);
      if (!usuario) return error(401, esAdmin ? 'Inicia sesión como administrador.' : 'Inicia sesión para continuar.');
      if (esAdmin) {
        if (usuario.rol !== 'admin') return error(403, 'Tu cuenta no tiene permisos de administrador.');
        if (m === 'GET' && ruta === '/api/admin/kpis') return await kpisAdmin(env);
        if (m === 'GET' && ruta === '/api/admin/pedidos') return await adminPedidos(env);
        const est = /^\/api\/admin\/pedidos\/([^/]+)\/estado$/.exec(ruta);
        if (est && (m === 'POST' || m === 'PATCH')) return await cambiarEstado(env, request, decodeURIComponent(est[1]));
      } else {
        if (cancelar) return await cancelarMiPedido(env, decodeURIComponent(cancelar[1]), usuario);
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
