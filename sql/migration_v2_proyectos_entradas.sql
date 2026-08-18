-- =============================================================
-- ROMOR · Migración v2: proyectos + entradas
-- =============================================================
-- Corre esto UNA VEZ en tu proyecto de Supabase ya existente
-- (SQL Editor → New query → pega todo esto → Run).
-- No vuelve a insertar las categorías/proveedores que ya tienes,
-- solo agrega lo nuevo: proyectos, entradas, y liga tus gastos
-- actuales a un primer proyecto llamado "ROMOR".
-- =============================================================

-- 1) Quitar proveedores duplicados (de cuando el script se corrió dos veces)
delete from proveedores a
using proveedores b
where a.id > b.id
  and a.categoria_id is not distinct from b.categoria_id
  and a.nombre_empresa = b.nombre_empresa;

-- 2) Evitar que se vuelvan a duplicar en el futuro
alter table proveedores drop constraint if exists proveedores_categoria_nombre_key;
alter table proveedores add constraint proveedores_categoria_nombre_key unique (categoria_id, nombre_empresa);

-- 3) Tabla de proyectos
create table if not exists proyectos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  created_at timestamptz not null default now()
);

alter table proyectos enable row level security;
drop policy if exists "auth full access" on proyectos;
create policy "auth full access" on proyectos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 4) Crea tu primer proyecto y liga los gastos que ya tenías a él
insert into proyectos (nombre) values ('ROMOR')
on conflict (nombre) do nothing;

alter table gastos add column if not exists proyecto_id uuid references proyectos(id) on delete cascade;
create index if not exists idx_gastos_proyecto on gastos(proyecto_id);

update gastos
set proyecto_id = (select id from proyectos where nombre = 'ROMOR')
where proyecto_id is null;

-- 5) Tabla de entradas (dinero que entra: aportaciones/ingresos)
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

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_entradas_updated_at on entradas;
create trigger trg_entradas_updated_at
  before update on entradas
  for each row execute function set_updated_at();

alter table entradas enable row level security;
drop policy if exists "auth full access" on entradas;
create policy "auth full access" on entradas
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 6) Permisos explícitos a nivel de tabla para TODAS las tablas
-- (por si acaso; esto es lo que suele causar un 401 aunque la política de
-- seguridad esté bien puesta)
grant usage on schema public to authenticated;
grant select, insert, update, delete
  on table integrantes, categorias, proveedores, proyectos, gastos, entradas
  to authenticated;
