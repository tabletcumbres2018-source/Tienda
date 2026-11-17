# Plan: LocalStorage → Cloudflare Pages + Supabase (Postgres)

Fecha del plan: 17-nov-2026. Decisiones tomadas: **Cloudflare Pages + Functions** (misma API, casi sin cambios en el front) y **Supabase Auth** (usuarios y sesiones reales).

> **Aviso de tiempo.** La entrega final del pizarrón es el 18-nov. Esta migración toca base de datos, API, login y correo.
> Recomendación: presentar mañana la versión **ya terminada** (Node + SQL Server en local, o el paquete PHP/Hostgator) y hacer
> esta migración en una **rama aparte** (`migracion-supabase`), por fases con puntos de control (sección 6). Cada fase deja el sitio funcionando.

## 1. Comparación: carpeta local vs. GitHub (`tabletcumbres2018-source/Tienda`)

El repo tiene **1 archivo** (`Tienda.html`, 18 KB) y 4 commits (31-ago a 2-sep). Es el prototipo inicial.

| | GitHub (`Tienda.html`) | Local (proyecto actual) |
|---|---|---|
| Productos | 10 escritos a mano en el HTML | 500 desde la base de datos |
| Datos | ninguna base | SQL Server `MegaStoreDB` (6 tablas) |
| Servidor/API | no hay | `server.js` (Node) y versión PHP/MySQL en `deploy/` |
| Usuarios / sesiones | no hay login | registro e inicio de sesión en `localStorage` |
| Carrito | `localStorage` | `localStorage` por usuario |
| Envío | no hay | por código postal (`envio.js`) |
| Pagos | no hay | pasarela sandbox (`pagos.js`) |
| Pedidos | no hay | folio, estado, detalle, historial |
| Panel / KPIs | no hay | `/admin` con 5 KPIs y 3 gráficas |
| Correo de estado | no hay | `mailer.js`, `smtp.js`, `correo.php` |
| Reseñas, anuncios, tema | no hay | sí (verde y café) |

**Conclusión:** lo local es un superconjunto; nada de GitHub se pierde. Se reemplaza `Tienda.html` por la estructura nueva
(el historial queda en git). El carrito de GitHub ya está incluido en `index.html`.

## 2. Arquitectura destino

```
Navegador
  ├─ páginas estáticas (public/)  ───────────►  Cloudflare Pages (gratis, desde GitHub)
  ├─ login/registro (supabase-js, llave pública) ► Supabase Auth
  └─ /api/*  (mismo dominio) ─► Pages Functions (functions/api/[[path]].js)
                                   ├─ envío por CP, pasarela sandbox, correo  (JS, reutiliza envio.js/pagos.js)
                                   ├─ valida el JWT del usuario (getClaims)
                                   └─ habla con Supabase Postgres usando la llave SECRETA (solo en Cloudflare)
Supabase: Postgres + Auth + RLS
```

- La **llave publicable** (`sb_publishable_…`) puede ir en el navegador. La **llave secreta** (`sb_secret_…`) vive solo como
  secreto cifrado en Cloudflare. Nunca en GitHub ni en el HTML. (Las llaves viejas `anon`/`service_role` funcionan hasta fin de 2026: usar las nuevas.)
- El **administrador** deja de usar una clave compartida: es un usuario de Supabase con `app_metadata.rol = "admin"`
  (nunca `user_metadata`, que el usuario puede editar).
- El servidor identifica al cliente por su **sesión**, no por el correo que manda la página (se cierra la brecha actual).

## 3. Traducción SQL Server → Postgres

| SQL Server | Postgres |
|---|---|
| `INT IDENTITY(1,1)` | `bigint generated always as identity` |
| `NVARCHAR(n)` / `NVARCHAR(MAX)` | `text` (con `check` si importa el largo) |
| `DECIMAL(10,2)` | `numeric(10,2)` |
| `DATETIME2` / `SYSDATETIME()` | `timestamptz` / `now()` |
| `Folio AS (... ) PERSISTED` | `default 'MS-' \|\| lpad(nextval('pedidos_folio_seq')::text, 6, '0')` |
| `CHECK (Estado IN (...))` | igual (`check (estado in (...))`) |
| `TOP n` | `limit n` |
| `ISNULL(x, 0)` | `coalesce(x, 0)` |
| `DATEADD(DAY,-29,CAST(SYSDATETIME() AS DATE))` | `current_date - 29` |
| `CONVERT(varchar(10), CAST(Fecha AS DATE), 23)` | `to_char(creado_en, 'YYYY-MM-DD')` |
| `OUTPUT INSERTED.Id, INSERTED.Folio` | `returning id, folio` |
| `@parametro` + `sql.Request` | parámetros de función RPC / supabase-js |
| error 2627 (llave duplicada) | SQLSTATE `23505` |
| transacción `BEGIN TRAN` desde Node | función `plpgsql` (atómica) llamada por RPC |
| `DBCC CHECKIDENT … RESEED` | `alter table … alter column id restart with N` |
| Mayúsculas en nombres (`Productos`, `Titulo`) | `snake_case` minúsculas (`productos`, `titulo`) |

Borrador listo: [`borrador-esquema-postgres.sql`](borrador-esquema-postgres.sql) (tablas, índices en llaves foráneas, RLS, permisos explícitos, trigger de perfil).
**No está aplicado.** Se revisa contigo y se aplica en la Fase 1.

Diseño de seguridad (Supabase): RLS activo en todas las tablas; se **revocan** los permisos automáticos de `anon`/`authenticated`;
catálogo y anuncios son de lectura pública; cada cliente ve solo sus pedidos; reseñas públicas **sin** exponer `usuario_id`;
crear pedidos, reseñas y cambiar estados solo lo hace el servidor con la llave secreta.

## 4. Estructura nueva del repositorio

```
Tienda/
├─ public/                      <- lo que sirve Cloudflare Pages
│  ├─ index.html                (tienda)
│  ├─ admin/index.html          (panel)
│  └─ config.js                 (URL de Supabase + llave PUBLICABLE)
├─ functions/api/
│  ├─ [[path]].js               (router: mismas rutas que hoy)
│  └─ _lib/  envio.js  pagos.js  correo.js  supabase.js  auth.js
├─ supabase/migrations/         (SQL versionado: esquema, RPC, datos semilla)
├─ legacy/                      (server.js, SQL Server, deploy PHP: referencia, sin usar)
├─ docs/                        (este plan y el borrador SQL)
├─ package.json  .gitignore  .dev.vars.example  README.md
```
`.gitignore` debe incluir `node_modules/`, `.dev.vars`, `admin.config.json`. **Ningún secreto en git.**

## 5. Cambios por archivo

| Archivo actual | Destino | Cambio |
|---|---|---|
| `index.html` | `public/index.html` | login/registro con `supabase-js`; `fetch` con `Authorization: Bearer <token>`; se quita el payload `usuario` |
| `admin.html` | `public/admin/index.html` | login de Supabase en vez de `x-admin-key` |
| `envio.js`, `pagos.js`, `mailer.js` | `functions/api/_lib/` | casi sin cambios (JS puro); `smtp.js` se reemplaza por API de correo (Workers no usan SMTP clásico) |
| `server.js` (SQL Server) | `functions/api/[[path]].js` | mismas rutas, consultas con supabase-js / RPC |
| `*.sql` (SQL Server) | `legacy/` | reemplazados por `supabase/migrations/` |
| `tools/exportar-mysql.js` | nuevo `tools/exportar-postgres.js` | genera la carga de 500 productos y anuncios |
| `deploy/` (PHP/MySQL) | `legacy/` | se conserva como plan B para Hostgator |
| `package.json` | actualizar | quitar `mssql`, `msnodesqlv8`, `express`, `nodemailer`; agregar `@supabase/supabase-js` (versión fija) |

Rutas de la API que se conservan: `GET /api/productos`, `/anuncios`, `/envio?cp=`, `/resenas/resumen`, `/resenas?producto=`;
`POST /api/resenas`, `POST /api/pedidos`, `GET /api/pedidos` (ahora con sesión);
`GET /api/admin/kpis`, `GET /api/admin/pedidos`, `POST /api/admin/pedidos/:folio/estado` (ahora solo administradores).

Funciones SQL que se escriben en la Fase 3/4 (todas `SECURITY INVOKER`, ejecutables solo por `service_role`):
`precio_carrito(items)`, `crear_pedido(...)`, `cambiar_estado_pedido(folio, estado)`, `kpis_admin()`.

## 6. Fases (cada una deja el sitio funcionando)

| Fase | Qué se hace | Punto de control |
|---|---|---|
| **0** Preparar repo | clonar a carpeta de trabajo, rama `migracion-supabase`, reorganizar archivos | repo ordenado, sin push |
| **1** Base de datos | revisar y aplicar el esquema; cargar los 500 productos y anuncios; probar con consultas | `select count(*) from productos` = 500 |
| **2** Lectura en vivo | Functions: productos, anuncios, envío, resumen de reseñas; subir a Cloudflare Pages | **catálogo visible en una URL `.pages.dev`** |
| **3** Usuarios y compra | Supabase Auth en el front; Functions: pedidos, reseñas, mis pedidos; funciones SQL | compra completa con tarjeta 4242 y folio |
| **4** Admin y correo | panel con login de administrador, KPIs, cambio de estado + correo por API | correo de estado llega a la bandeja |
| **5** Limpieza | mover `legacy/`, README, revisar advisors de seguridad, dominio propio | `get_advisors` sin alertas críticas |

Lo que **no** se migra: los 2 pedidos de prueba (`MS-000001/2`) y los usuarios de `localStorage` (sus contraseñas están en texto plano
en el navegador; los clientes se vuelven a registrar).

## 7. Guía: lo que haces tú (en orden)

### A. Supabase (proyecto `sqkafwhbyhyqouetmbbl`, hoy vacío)
1. Dashboard → **Project Settings → API Keys**: crea una llave **Publishable** y una **Secret**. Cópialas solo a Cloudflare (paso C). No las pegues en chat ni en GitHub.
2. **Authentication → Providers → Email**: decide si exiges confirmar el correo. Para probar rápido, desactiva la confirmación; para producción actívala y configura SMTP propio (el correo integrado de Supabase tiene un límite bajo).
3. **Authentication → URL Configuration**: más adelante pondrás ahí la URL de Cloudflare (Site URL y Redirect URLs).

### B. GitHub
1. El repo ya existe: `tabletcumbres2018-source/Tienda`.
2. Con tu **permiso explícito** yo clono, creo la rama `migracion-supabase` y subo (push). Después abres un Pull Request hacia `main`.
3. Cloudflare dará una URL de prueba para cada rama.

### C. Cloudflare Pages
1. Dashboard → **Workers & Pages → Create application → Pages → Connect to Git** → GitHub → autoriza **solo** el repo `Tienda`.
2. Rama de producción: `main`. **Build command:** vacío. **Build output directory:** `public`. Guarda y despliega.
3. Proyecto → **Settings → Variables and Secrets** y agrega (marca **Encrypt** en los secretos; luego no se pueden volver a ver):

| Nombre | Tipo | Valor |
|---|---|---|
| `SUPABASE_URL` | variable | `https://sqkafwhbyhyqouetmbbl.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | variable | llave publicable |
| `SUPABASE_SECRET_KEY` | **secreto** | llave secreta |
| `ORIGEN_ESTADO` | variable | estado de tu bodega |
| `EMAIL_API_KEY` | **secreto** | llave del proveedor de correo (Fase 4) |
| `EMAIL_FROM` | variable | remitente verificado |

4. Aviso de Cloudflare: con integración Git **no se puede cambiar después a "Direct Upload"**.
5. Copia la URL `https://<proyecto>.pages.dev` a Supabase → Authentication → URL Configuration.

### D. Administrador
1. Regístrate en la tienda ya desplegada.
2. En Supabase → SQL Editor:
   `update auth.users set raw_app_meta_data = raw_app_meta_data || '{"rol":"admin"}'::jsonb where email = 'tu@correo.com';`
3. Cierra sesión y vuelve a entrar (el rol viaja en el token).

### E. Correo (Fase 4)
Cloudflare Workers no envían por SMTP como Node. Se usa la API HTTP de un proveedor (por ejemplo Resend o Brevo; **por verificar**
cuál conviene y si exige dominio propio). Se decide al llegar a la Fase 4.

## 8. Riesgos y pendientes

- **Compatibilidad de `supabase-js` en Pages Functions:** no pude confirmarla en la documentación leída. Se prueba en la Fase 2; plan B: llamar a la API REST de Supabase con `fetch`.
- **Límites gratis de Cloudflare:** las Functions cuentan en la cuota diaria de Workers (ejemplo de la documentación: 100,000 peticiones/día); los archivos estáticos son gratis e ilimitados.
- **Proyectos gratis de Supabase:** revisa en tu panel la política de pausa por inactividad y los límites de correo de Auth.
- **Datos:** los títulos y fotos ya están corregidos en SQL Server; la exportación a Postgres debe salir de ahí.
- **Tiempo:** ver aviso al inicio. No migrar a Postgres en una sola noche sin plan B.
