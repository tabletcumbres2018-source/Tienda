// Acceso a Supabase con fetch puro (sin librerías): PostgREST con la llave secreta y verificación de usuarios por Auth.
// SUPABASE_SECRET_KEY solo existe en el servidor (Cloudflare). Nunca se envía al navegador.

export class ErrorDB extends Error {
  constructor(status, cuerpo) {
    super(cuerpo?.message || `Supabase respondió ${status}`);
    this.status = status; this.codigo = cuerpo?.code; this.detalle = cuerpo;
  }
}

// Llamada a PostgREST (/rest/v1/...) como service_role
export async function db(env, ruta, { metodo = 'GET', cuerpo, prefer } = {}) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${ruta}`, {
    method: metodo,
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {})
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
  });
  const texto = await r.text();
  const datos = texto ? JSON.parse(texto) : null;
  if (!r.ok) throw new ErrorDB(r.status, datos);
  return datos;
}

export const rpc = (env, nombre, args = {}) => db(env, `rpc/${nombre}`, { metodo: 'POST', cuerpo: args });

// Verifica el JWT del usuario con Supabase Auth. Devuelve { id, correo, nombre, rol } o null.
export async function usuarioDeSolicitud(env, request) {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') || '');
  if (!m) return null;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${m[1]}` }
  });
  if (!r.ok) return null;
  const u = await r.json();
  if (!u?.id || !u.email) return null;
  return {
    id: u.id,
    correo: String(u.email).toLowerCase(),
    nombre: String(u.user_metadata?.nombre || u.email.split('@')[0]).trim().slice(0, 100),
    rol: u.app_metadata?.rol || null        // app_metadata solo lo puede cambiar el servidor (nunca el usuario)
  };
}
