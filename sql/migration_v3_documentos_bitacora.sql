-- =============================================================
-- ROMOR · Migración v3: documentos + bitácora de avance
-- =============================================================
-- Corre esto UNA VEZ en tu proyecto de Supabase ya existente
-- (SQL Editor → New query → pega todo esto → Run).
-- Agrega dos tablas nuevas: "documentos" (contratos, permisos,
-- planos por proyecto) y "bitacora" (registro de avance con fotos
-- y notas). Reutiliza el bucket "comprobantes" que ya tienes creado
-- para guardar los archivos, así que NO necesitas crear ningún
-- bucket nuevo en Storage.
-- No borra ni modifica nada de lo que ya tenías.
-- =============================================================

-- 1) Documentos del proyecto (contratos, permisos, planos, etc.)
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

alter table documentos enable row level security;
drop policy if exists "auth full access" on documentos;
create policy "auth full access" on documentos
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 2) Bitácora de avance (registro con fecha, nota y fotos)
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

alter table bitacora enable row level security;
drop policy if exists "auth full access" on bitacora;
create policy "auth full access" on bitacora
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 3) Permisos explícitos (igual que las demás tablas)
grant select, insert, update, delete on table documentos, bitacora to authenticated;
