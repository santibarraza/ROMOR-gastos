-- =============================================================
-- ROMOR · Migración v4: bitácora automática por WhatsApp
-- =============================================================
-- Corre esto UNA VEZ en tu proyecto de Supabase ya existente
-- (SQL Editor → New query → pega todo esto → Run).
--
-- Agrega:
-- 1) La columna "telefono" a "integrantes", para que la función que
--    recibe los mensajes de WhatsApp sepa QUIÉN mandó cada foto/nota
--    (y así rellenar "capturado_por" automáticamente en la bitácora).
-- 2) La tabla "wa_bitacora_inbox": un buzón temporal donde se guardan
--    las fotos que llegan por WhatsApp mientras se espera el mensaje
--    de texto con el nombre del proyecto (que es lo que las agrupa en
--    una sola entrada de bitácora). Una vez usadas, se borran solas.
--
-- IMPORTANTE: esta tabla NO la usa la app (index.html/main.js) ni
-- pasa por Supabase Auth — solo la usa la función serverless de
-- api/whatsapp-bitacora.js, que se conecta con la llave de servicio
-- (service_role), la cual se salta RLS por diseño de Supabase. Por
-- eso NO se le da ningún permiso a "authenticated" sobre esta tabla:
-- ningún usuario de la app debe poder leerla o escribirla directo.
--
-- No borra ni modifica nada de lo que ya tenías.
-- =============================================================

-- 1) Teléfono de cada integrante (formato con código de país y "+",
--    ej. "+5216671234567" para México, tal como lo manda Twilio en
--    el remitente de cada mensaje de WhatsApp, ya sin el prefijo
--    "whatsapp:" que Twilio le pone delante).
alter table integrantes add column if not exists telefono text;
create unique index if not exists idx_integrantes_telefono on integrantes(telefono) where telefono is not null;

-- 2) Buzón temporal de fotos de WhatsApp
create table if not exists wa_bitacora_inbox (
  id uuid primary key default gen_random_uuid(),
  telefono text not null,
  foto_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_wa_inbox_telefono on wa_bitacora_inbox(telefono);

alter table wa_bitacora_inbox enable row level security;
-- Sin políticas para "authenticated": solo el service_role (que
-- ignora RLS) debe poder tocar esta tabla.
