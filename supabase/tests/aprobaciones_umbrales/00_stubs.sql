-- Esquema mínimo que imita Supabase para probar la lógica de aprobaciones.
do $r$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $r$;
create schema auth; create schema app_private;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table public.roles (id uuid primary key default gen_random_uuid(), nombre text unique not null);
create table public.permisos (id uuid primary key default gen_random_uuid(), modulo text, accion text, unique(modulo,accion));
create table public.rol_permisos (rol_id uuid references public.roles, permiso_id uuid references public.permisos, primary key(rol_id, permiso_id));
create table public.usuarios (id uuid primary key, nombre text, email text, activo boolean default true, rol_id uuid references public.roles);
create table public.auditoria (id bigint generated always as identity primary key, usuario_id uuid, usuario_email text, accion text, modulo text, registro_id text, datos_antes jsonb, datos_despues jsonb, created_at timestamptz default now());
create function public.tiene_permiso(p_modulo text, p_accion text) returns boolean language sql stable security definer set search_path='' as $$
  select exists (select 1 from public.usuarios u join public.rol_permisos rp on rp.rol_id=u.rol_id join public.permisos p on p.id=rp.permiso_id
                 where u.id = auth.uid() and u.activo and p.modulo=p_modulo and p.accion=p_accion) $$;
create table auth.users (id uuid primary key);
-- Stubs de dominio: emiten "documentos" verificando permisos como los reales.
create table public.stub_ordenes (id uuid primary key default gen_random_uuid(), origen text, creado_por uuid);
create function public.crear_orden_compra_operativa_v4(uuid,text,date,numeric,jsonb,text,text,numeric) returns uuid language plpgsql security definer set search_path='' as $$
 declare v uuid; begin
 if not public.tiene_permiso('compras','crear') then raise exception 'sin permiso compras' using errcode='42501'; end if;
 insert into public.stub_ordenes(origen,creado_por) values('manual', auth.uid()) returning id into v; return v; end $$;
create function public.convertir_solicitud_a_orden_v1(uuid,text) returns uuid language plpgsql security definer set search_path='' as $$
 declare v uuid; begin insert into public.stub_ordenes(origen,creado_por) values('comparativo', auth.uid()) returning id into v; return v; end $$;
create function public.crear_orden_compra_desde_contrato_v1(uuid,uuid,text,date,jsonb,text,numeric) returns uuid language plpgsql security definer set search_path='' as $$
 declare v uuid; begin insert into public.stub_ordenes(origen,creado_por) values('contrato', auth.uid()) returning id into v; return v; end $$;
create table public.ec_conteos_fisicos (id uuid primary key, estado text, snap jsonb);
create function app_private._ec_physical_count_snapshot_v1(uuid) returns jsonb language sql stable as $$ select snap from public.ec_conteos_fisicos where id=$1 $$;
create function public.ec_cerrar_inventario_fisico(uuid,text) returns uuid language plpgsql security definer set search_path='' as $$
 begin update public.ec_conteos_fisicos set estado='cerrado' where id=$1 and estado='pendiente_aprobacion'; if not found then raise exception 'conteo no pendiente' using errcode='23514'; end if; return $1; end $$;
-- Solicitud: imita ec_solicitar_aprobacion_* (snapshot + evento 'solicitada'); el SQL real del trigger/decisión es el del repo.
create function public.stub_solicitar(p_tipo text, p_snapshot jsonb, p_key text, p_origen uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
 declare v_id uuid; begin
 insert into public.ec_solicitudes_aprobacion(tipo,origen_id,solicitante_id,idempotency_key,snapshot,snapshot_hash)
 values (p_tipo,p_origen,auth.uid(),p_key,p_snapshot,md5(p_snapshot::text)) returning id into v_id;
 perform app_private._ec_insert_approval_event_v1(v_id, auth.uid(), 'solicitada', null, p_snapshot);
 if p_tipo='physical_count' then update public.ec_conteos_fisicos set estado='pendiente_aprobacion', snap=p_snapshot where id=p_origen; end if;
 return v_id; end $$;
