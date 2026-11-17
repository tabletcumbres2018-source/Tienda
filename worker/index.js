// Punto de entrada para Cloudflare Workers (con archivos estáticos de public/).
// /api/* ejecuta este Worker; el resto lo sirve Cloudflare directamente desde public/.
// Reutiliza el mismo código de la API que functions/api/[[path]].js (Pages Functions).
import { onRequest } from '../functions/api/[[path]].js';

export default {
  async fetch(request, env, ctx) {
    return onRequest({ request, env, waitUntil: p => ctx.waitUntil(p) });
  }
};
