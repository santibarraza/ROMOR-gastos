-- =============================================================
-- ROMOR · Migración v18: corrige los check constraints de "riesgos"
-- =============================================================
-- Corre esto UNA VEZ en tu proyecto de Supabase (SQL Editor → New
-- query → pega todo esto → Run).
--
-- Qué pasó: al guardar un riesgo nuevo salía el error
--   "new row for relation "riesgos" violates check constraint
--    "riesgos_impacto_check""
-- Eso significa que el constraint de la columna "impacto" en tu base
-- de datos no coincide con los valores que manda la app ('bajo',
-- 'medio', 'alto') — probablemente quedó mal definido desde que se
-- creó la tabla (una mezcla con los valores de "probabilidad", que
-- llevan género distinto: 'baja'/'media'/'alta').
--
-- Esta migración reemplaza los tres constraints de "riesgos"
-- (probabilidad/impacto/estado) por los valores correctos, sin tocar
-- ninguna otra columna ni borrar datos existentes. Es segura de
-- correr más de una vez.
-- =============================================================

alter table riesgos drop constraint if exists riesgos_probabilidad_check;
alter table riesgos add constraint riesgos_probabilidad_check
  check (probabilidad in ('baja', 'media', 'alta'));

alter table riesgos drop constraint if exists riesgos_impacto_check;
alter table riesgos add constraint riesgos_impacto_check
  check (impacto in ('bajo', 'medio', 'alto'));

alter table riesgos drop constraint if exists riesgos_estado_check;
alter table riesgos add constraint riesgos_estado_check
  check (estado in ('abierto', 'mitigado', 'cerrado'));
