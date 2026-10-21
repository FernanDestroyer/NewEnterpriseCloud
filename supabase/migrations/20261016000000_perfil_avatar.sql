-- =============================================================================
-- ERP EnterpriseCloud · Foto de perfil del usuario
-- Agrega la columna avatar_url a public.usuarios para guardar la foto de
-- perfil (data URL optimizada desde la aplicación, sin Storage adicional).
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

alter table public.usuarios add column if not exists avatar_url text;

comment on column public.usuarios.avatar_url is 'Foto de perfil del usuario (data URL o URL pública). NULL = sin foto, se muestran las iniciales.';
