# Versión local (legacy)

Servidor Node + SQL Server para desarrollo en Windows (`node server.js` desde esta carpeta, tras `npm install`).
La tienda en línea NO usa esta carpeta: sale de `public/` y `functions/` (Cloudflare Pages + Supabase).
Esta carpeta vive aparte para que Cloudflare no intente instalar `msnodesqlv8` (solo Windows).
