-- =============================================================
-- ROMOR · Control de gastos de obra
-- Esquema de base de datos para Supabase (Postgres)
-- =============================================================
-- Cómo usar este archivo:
-- 1. Entra a tu proyecto en https://supabase.com/dashboard
-- 2. Ve a "SQL Editor" (menú izquierdo) > "New query"
-- 3. Pega TODO este archivo y dale "Run"
-- Esto crea las tablas, activa seguridad por fila (RLS) y
-- precarga las categorías y proveedores que ya tenías capturados.
-- =============================================================

-- Extensión para generar UUIDs
create extension if not exists "pgcrypto";

-- -------------------------------------------------------------
-- Tabla: integrantes (las personas del equipo que capturan/pagan gastos)
-- -------------------------------------------------------------
create table if not exists integrantes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  -- Teléfono con código de país y "+" (ej. "+5216671234567", tal
  -- como lo manda Twilio, sin el prefijo "whatsapp:") — se usa para
  -- identificar quién manda bitácora automática por WhatsApp (ver
  -- api/whatsapp-bitacora.js).
  telefono text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_integrantes_telefono on integrantes(telefono) where telefono is not null;

-- -------------------------------------------------------------
-- Tabla: categorias (partidas de la obra)
-- -------------------------------------------------------------
create table if not exists categorias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  orden int not null default 0,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------
-- Tabla: proyectos (puedes tener varios proyectos/obras)
-- -------------------------------------------------------------
create table if not exists proyectos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------
-- Tabla: proveedores
-- -------------------------------------------------------------
create table if not exists proveedores (
  id uuid primary key default gen_random_uuid(),
  categoria_id uuid references categorias(id) on delete set null,
  nombre_empresa text not null,
  contacto text,
  telefono text,
  correo text,
  ciudad text,
  notas text,
  created_at timestamptz not null default now(),
  unique (categoria_id, nombre_empresa)
);

-- -------------------------------------------------------------
-- Tabla: gastos
-- -------------------------------------------------------------
create table if not exists gastos (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid references proyectos(id) on delete cascade,
  fecha date not null default current_date,
  monto numeric(12,2) not null check (monto > 0),
  categoria_id uuid references categorias(id) on delete set null,
  proveedor_id uuid references proveedores(id) on delete set null,
  proveedor_texto text, -- por si el proveedor no está en el catálogo
  descripcion text,
  metodo_pago text not null default 'Efectivo',
  pagado_por text,       -- nombre de quién puso el dinero
  capturado_por text,    -- nombre de quién registró el gasto
  comprobante_url text,  -- URL pública del archivo en Storage
  comprobante_nombre text,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_gastos_categoria on gastos(categoria_id);
create index if not exists idx_gastos_fecha on gastos(fecha);
create index if not exists idx_gastos_proyecto on gastos(proyecto_id);

-- -------------------------------------------------------------
-- Tabla: entradas (dinero que entra al proyecto: aportaciones, ingresos)
-- -------------------------------------------------------------
create table if not exists entradas (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid references proyectos(id) on delete cascade,
  fecha date not null default current_date,
  monto numeric(12,2) not null check (monto > 0),
  concepto text,
  aportado_por text,
  capturado_por text,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_entradas_proyecto on entradas(proyecto_id);

-- -------------------------------------------------------------
-- Tabla: documentos (contratos, permisos, planos por proyecto)
-- -------------------------------------------------------------
create table if not exists documentos (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid references proyectos(id) on delete cascade,
  nombre text not null,
  tipo text, -- Contrato / Permiso / Plano / Otro (libre)
  url text not null,
  subido_por text,
  created_at timestamptz not null default now()
);

create index if not exists idx_documentos_proyecto on documentos(proyecto_id);

-- -------------------------------------------------------------
-- Tabla: bitacora (registro de avance de obra: fecha, nota, fotos)
-- -------------------------------------------------------------
create table if not exists bitacora (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid references proyectos(id) on delete cascade,
  fecha date not null default current_date,
  nota text,
  fotos text[] not null default '{}',
  capturado_por text,
  created_at timestamptz not null default now()
);

create index if not exists idx_bitacora_proyecto on bitacora(proyecto_id);

-- -------------------------------------------------------------
-- Tabla: wa_bitacora_inbox (buzón temporal de fotos de WhatsApp,
-- ver api/whatsapp-bitacora.js — NO la usa la app, solo la función
-- serverless con la llave service_role, por eso no lleva políticas
-- para "authenticated" ni se le hace grant más abajo)
-- -------------------------------------------------------------
create table if not exists wa_bitacora_inbox (
  id uuid primary key default gen_random_uuid(),
  telefono text not null,
  foto_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_wa_inbox_telefono on wa_bitacora_inbox(telefono);

-- -------------------------------------------------------------
-- Trigger para actualizar updated_at automáticamente
-- -------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_gastos_updated_at on gastos;
create trigger trg_gastos_updated_at
  before update on gastos
  for each row execute function set_updated_at();

drop trigger if exists trg_entradas_updated_at on entradas;
create trigger trg_entradas_updated_at
  before update on entradas
  for each row execute function set_updated_at();

-- -------------------------------------------------------------
-- Seguridad: activar RLS y permitir solo a usuarios autenticados
-- (Todo el equipo entra con el mismo usuario/contraseña compartida,
-- así que cualquier persona autenticada puede leer y escribir todo,
-- tal como se pidió: "todos pueden editar todo")
-- -------------------------------------------------------------
alter table integrantes enable row level security;
alter table categorias enable row level security;
alter table proveedores enable row level security;
alter table proyectos enable row level security;
alter table gastos enable row level security;
alter table entradas enable row level security;
alter table documentos enable row level security;
alter table bitacora enable row level security;
alter table wa_bitacora_inbox enable row level security;
-- wa_bitacora_inbox NO lleva política para "authenticated": solo la
-- toca la función serverless con la llave service_role (que ignora
-- RLS), ningún usuario de la app debe poder leerla ni escribirla.

drop policy if exists "auth full access" on integrantes;
create policy "auth full access" on integrantes
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "auth full access" on categorias;
create policy "auth full access" on categorias
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "auth full access" on proveedores;
create policy "auth full access" on proveedores
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "auth full access" on proyectos;
create policy "auth full access" on proyectos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "auth full access" on gastos;
create policy "auth full access" on gastos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "auth full access" on entradas;
create policy "auth full access" on entradas
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "auth full access" on documentos;
create policy "auth full access" on documentos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "auth full access" on bitacora;
create policy "auth full access" on bitacora
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Permisos explícitos a nivel de tabla (además de RLS). Sin esto, algunas
-- tablas pueden devolver 401 "permission denied" aunque la política exista.
grant usage on schema public to authenticated;
grant select, insert, update, delete on table integrantes, categorias, proveedores, proyectos, gastos, entradas, documentos, bitacora to authenticated;

-- =============================================================
-- Datos iniciales: un primer proyecto, categorías (partidas) y
-- proveedores ya capturados en el documento de ROMOR (16 ago 2026)
-- =============================================================
insert into proyectos (nombre) values ('ROMOR')
on conflict (nombre) do nothing;

insert into categorias (nombre, orden) values
  ('Eléctrico', 10),
  ('Hidrosanitario y gas', 20),
  ('Materiales', 30),
  ('Ventanería', 40),
  ('Herrería', 50),
  ('Carpintería', 60),
  ('Concreto', 70),
  ('Persianas', 80),
  ('HVAC', 90),
  ('Tablaroca', 100),
  ('Plomería general', 110),
  ('Pintura', 120),
  ('Impermeabilización', 130),
  ('Cancelería', 140),
  ('Cocina / Closets', 150),
  ('Mano de obra', 160),
  ('Permisos y trámites', 170),
  ('Otro', 999)
on conflict (nombre) do nothing;

-- Proveedores (se ligan a su categoría por nombre)
insert into proveedores (categoria_id, nombre_empresa, contacto, telefono, ciudad, notas)
select c.id, v.nombre_empresa, v.contacto, v.telefono, v.ciudad, v.notas
from (values
  ('Eléctrico', 'Chema', 'Josue Rojas', '667 578 2011', 'Culiacán, Sin.', null),
  ('Hidrosanitario y gas', 'Juan Luis', 'Juan Luis González', '667 175 0042', 'Culiacán, Sin.', null),
  ('Materiales', 'HM Express', 'Rosario', '667 730 4408', 'Culiacán, Sin.', null),
  ('Ventanería', 'SINALUM', 'Miguel', '667 207 7366', 'Culiacán, Sin.', null),
  ('Herrería', 'Cesar Madrid', 'Cesar Madrid', '667 190 8225', 'Culiacán, Sin.', null),
  ('Carpintería', 'Corcas', 'Jose Luis Castañeda', '667 161 5681', 'Culiacán, Sin.', null),
  ('Concreto', 'BAZUA', 'Lorena', '687 120 8679', 'Culiacán, Sin.', null),
  ('Persianas', 'Senz', 'Melissa', null, 'Culiacán, Sin.', 'Falta WhatsApp/teléfono'),
  ('HVAC', 'Chaidez', 'Ernesto Chaidez', '672 854 3476', 'Culiacán, Sin.', null),
  ('Materiales', 'Aceros el Sinaloense', 'Rodolfo Osuna', '667 996 7111', 'Culiacán, Sin.', 'Acero'),
  ('Tablaroca', 'Jose Rojas', 'Jose Rojas', '667 756 7884', 'Culiacán, Sin.', null)
) as v(categoria_nombre, nombre_empresa, contacto, telefono, ciudad, notas)
join categorias c on c.nombre = v.categoria_nombre
on conflict (categoria_id, nombre_empresa) do nothing;

-- =============================================================
-- Storage: crea el bucket para los comprobantes (fotos/PDFs)
-- Esto NO se puede hacer por SQL editor normal; hazlo así:
-- 1. Ve a "Storage" en el menú izquierdo
-- 2. "New bucket" > nombre: comprobantes > Public bucket: ACTIVADO
-- 3. Crea el bucket
-- Luego regresa aquí y corre lo siguiente para las políticas:
-- =============================================================
insert into storage.buckets (id, name, public)
values ('comprobantes', 'comprobantes', true)
on conflict (id) do nothing;

drop policy if exists "auth full access comprobantes" on storage.objects;
create policy "auth full access comprobantes" on storage.objects
  for all using (bucket_id = 'comprobantes' and auth.role() = 'authenticated')
  with check (bucket_id = 'comprobantes' and auth.role() = 'authenticated');
