-- =============================================================
-- ROMOR · Migración v17: Acabados (pinturas, pisos, etc. por proyecto)
-- =============================================================
-- Corre esto UNA VEZ en tu proyecto de Supabase ya existente
-- (SQL Editor → New query → pega todo esto → Run).
--
-- Requiere que ya exista la tabla "proyectos".
--
-- Agrega la tabla "acabados": un registro simple de qué se puso
-- exactamente en cada zona de la obra — pintura, piso, azulejo,
-- herrería, carpintería, cancelería u otro — con marca/color/modelo,
-- proveedor y notas. Siempre pertenece a un proyecto (a diferencia de
-- "recordatorios" o "riesgos", que pueden ser generales).
--
-- No borra ni modifica nada de lo que ya tenías.
-- =============================================================

create table if not exists acabados (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references proyectos(id) on delete cascade,
  zona text not null,
  categoria text not null default 'otro'
    check (categoria in ('pintura', 'piso', 'azulejo', 'herreria', 'carpinteria', 'canceleria', 'otro')),
  categoria_otro text,
  marca_color text,
  proveedor text,
  notas text,
  creado_por text,
  created_at timestamptz not null default now()
);

create index if not exists idx_acabados_proyecto on acabados(proyecto_id);

alter table acabados enable row level security;

drop policy if exists "auth full access" on acabados;
create policy "auth full access" on acabados
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Permisos explícitos a nivel de tabla (además de RLS) — sin esto,
-- algunas tablas pueden devolver 401 "permission denied" aunque la
-- política exista.
grant select, insert, update, delete on table acabados to authenticated;
