-- =====================================================================================
-- BORRADOR del esquema Postgres para Supabase  (NO está aplicado en ningún proyecto)
-- Traducción de MegaStoreDB (SQL Server) + Supabase Auth + RLS.
-- Se revisa y se aplica en la Fase 1 del plan (docs/PLAN-CLOUDFLARE-SUPABASE.md).
-- Reglas que sigue: snake_case, timestamptz, numeric para dinero, RLS en todas las tablas,
-- permisos explícitos (se revocan los automáticos), índices en llaves foráneas.
-- =====================================================================================

create schema if not exists private;   -- no expuesto por la API

-- ---------- Catálogo ----------
create table public.productos (
    id              bigint generated always as identity primary key,
    titulo          text          not null,
    categoria       text          not null,
    marca           text          not null,
    precio          numeric(10,2) not null check (precio >= 0),
    caracteristicas text          not null,   -- "A | B | C"  (igual que en SQL Server)
    colores         text          not null,   -- "Plata, Azul"
    imagen          text          not null
);
create index productos_categoria_idx on public.productos (categoria);

create table public.anuncios (
    id          bigint generated always as identity primary key,
    tipo        text    not null check (tipo in ('banner', 'producto')),
    titulo      text,
    texto       text,
    boton       text,
    categoria   text,
    tema        text    not null default 'azul' check (tema in ('azul', 'morado', 'verde', 'naranja')),
    producto_id bigint  references public.productos (id),
    orden       int     not null default 0,
    activo      boolean not null default true
);
create index anuncios_producto_idx on public.anuncios (producto_id);

-- ---------- Usuarios (Supabase Auth) ----------
-- Las cuentas viven en auth.users (contraseñas cifradas por Supabase). Aquí solo el nombre visible.
create table public.perfiles (
    id        uuid primary key references auth.users (id) on delete cascade,
    nombre    text not null check (char_length(btrim(nombre)) between 1 and 100),
    creado_en timestamptz not null default now()
);

-- Crea el perfil automáticamente al registrarse. Vive en "private" (no se puede llamar por la API).
create function private.crear_perfil() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
    insert into public.perfiles (id, nombre)
    values (new.id, left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'nombre'), ''), split_part(new.email, '@', 1)), 100));
    return new;
end;
$$;
revoke execute on function private.crear_perfil() from public, anon, authenticated;
create trigger al_crear_usuario after insert on auth.users
    for each row execute function private.crear_perfil();

-- ---------- Pedidos ----------
create sequence public.pedidos_folio_seq;

create table public.pedidos (
    id               bigint generated always as identity primary key,
    folio            text not null unique default ('MS-' || lpad(nextval('public.pedidos_folio_seq')::text, 6, '0')),
    usuario_id       uuid not null references auth.users (id),
    cliente_nombre   text not null,
    cliente_correo   text not null,
    direccion        text not null,
    referencias      text not null,
    codigo_postal    text not null check (codigo_postal ~ '^[0-9]{5}$'),
    estado_envio     text not null,                          -- estado de la república que resuelve el CP
    distancia_km     int  not null,
    subtotal         numeric(10,2) not null,
    costo_envio      numeric(10,2) not null,
    total            numeric(10,2) not null,
    estado           text not null default 'Pagado' check (estado in ('Pendiente', 'Pagado', 'Enviado', 'Entregado', 'Cancelado')),
    metodo_pago      text not null,
    pago_referencia  text,
    tarjeta_ultimos4 text check (tarjeta_ultimos4 ~ '^[0-9]{4}$'),
    creado_en        timestamptz not null default now()
);
create index pedidos_usuario_idx on public.pedidos (usuario_id, creado_en desc);
create index pedidos_creado_idx  on public.pedidos (creado_en);

create table public.detalle_pedido (
    id              bigint generated always as identity primary key,
    pedido_id       bigint not null references public.pedidos (id) on delete cascade,
    producto_id     bigint not null references public.productos (id),
    producto        text   not null,
    color           text   not null,
    cantidad        int    not null check (cantidad > 0),
    precio_unitario numeric(10,2) not null
);
create index detalle_pedido_pedido_idx   on public.detalle_pedido (pedido_id);
create index detalle_pedido_producto_idx on public.detalle_pedido (producto_id);

create table public.correos_pedido (
    id        bigint generated always as identity primary key,
    pedido_id bigint not null references public.pedidos (id) on delete cascade,
    para      text   not null,
    asunto    text   not null,
    cuerpo    text   not null,
    resultado text   not null check (resultado in ('Enviado', 'Simulado', 'Error')),
    detalle   text,
    creado_en timestamptz not null default now()
);
create index correos_pedido_pedido_idx on public.correos_pedido (pedido_id);

-- ---------- Reseñas ----------
create table public.resenas (
    id             bigint generated always as identity primary key,
    producto_id    bigint   not null references public.productos (id),
    usuario_id     uuid     not null references auth.users (id),
    cliente_nombre text     not null,
    calificacion   smallint not null check (calificacion between 1 and 5),
    comentario     text     not null check (char_length(comentario) between 1 and 500),
    creado_en      timestamptz not null default now(),
    unique (producto_id, usuario_id)                -- una reseña por cliente y producto
);
create index resenas_usuario_idx on public.resenas (usuario_id);

-- =====================================================================================
-- SEGURIDAD: RLS en todo + permisos explícitos
-- =====================================================================================
alter table public.productos      enable row level security;
alter table public.anuncios       enable row level security;
alter table public.perfiles       enable row level security;
alter table public.pedidos        enable row level security;
alter table public.detalle_pedido enable row level security;
alter table public.correos_pedido enable row level security;
alter table public.resenas        enable row level security;

-- Quitar los permisos automáticos de Supabase y dar solo lo necesario
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Catálogo y anuncios: lectura pública
grant select on public.productos to anon, authenticated;
create policy productos_lectura_publica on public.productos for select to anon, authenticated using (true);

grant select on public.anuncios to anon, authenticated;
create policy anuncios_lectura_publica on public.anuncios for select to anon, authenticated using (activo);

-- Perfil: cada usuario ve y edita solo el suyo (solo la columna nombre)
grant select on public.perfiles to authenticated;
grant update (nombre) on public.perfiles to authenticated;
create policy perfiles_ver_propio on public.perfiles for select to authenticated using (id = (select auth.uid()));
create policy perfiles_editar_propio on public.perfiles for update to authenticated
    using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Pedidos: cada cliente ve solo los suyos. Crear/cambiar pedidos lo hace el servidor (service_role), nunca el navegador.
grant select on public.pedidos to authenticated;
create policy pedidos_ver_propios on public.pedidos for select to authenticated using (usuario_id = (select auth.uid()));

grant select on public.detalle_pedido to authenticated;
create policy detalle_ver_propio on public.detalle_pedido for select to authenticated
    using (exists (select 1 from public.pedidos p where p.id = pedido_id and p.usuario_id = (select auth.uid())));

-- correos_pedido: sin acceso desde la API (solo servidor)

-- Reseñas: lectura pública SIN exponer usuario_id; escribir solo desde el servidor
grant select (id, producto_id, cliente_nombre, calificacion, comentario, creado_en) on public.resenas to anon, authenticated;
create policy resenas_lectura_publica on public.resenas for select to anon, authenticated using (true);

-- Servidor (Cloudflare Functions con la llave secreta = service_role)
grant all on all tables    in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- =====================================================================================
-- PENDIENTE para la Fase 2 (funciones RPC, todas con SECURITY INVOKER y solo para service_role):
--   public.precio_carrito(p_items jsonb)       -> subtotal calculado con precios de la BD
--   public.crear_pedido(...)                   -> inserta pedido + detalle en una transacción
--   public.cambiar_estado_pedido(p_folio, ...) -> valida el flujo Pagado -> Enviado -> Entregado
--   public.kpis_admin()                        -> los 5 KPIs y las 3 gráficas del panel
-- Administrador: se marca con app_metadata (NUNCA user_metadata):
--   update auth.users set raw_app_meta_data = raw_app_meta_data || '{"rol":"admin"}'::jsonb where email = 'tu@correo.com';
-- =====================================================================================
