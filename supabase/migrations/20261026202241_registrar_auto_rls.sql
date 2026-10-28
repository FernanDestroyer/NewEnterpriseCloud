-- Captura en el historial el event trigger de seguridad que ya existe en Supabase.
-- Las tablas nuevas en public reciben RLS de inmediato; cada migración aún debe
-- definir sus grants y políticas específicas antes de exponerlas a la aplicación.
begin;

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  cmd record;
  tbl name;
begin
  for cmd in
    select *
    from pg_catalog.pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name is not null
       and cmd.schema_name = 'public'
       and cmd.schema_name not like 'pg_toast%'
       and cmd.schema_name not like 'pg_temp%' then
      begin
        select c.relname into tbl
        from pg_catalog.pg_class c
        where c.oid = cmd.objid;
        execute pg_catalog.format(
          'alter table if exists %I.%I enable row level security', cmd.schema_name, tbl
        );
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    else
      raise log 'rls_auto_enable: skip % (system schema or outside public)', cmd.object_identity;
    end if;
  end loop;
end;
$function$;

do $block$
declare
  v_trigger pg_catalog.pg_event_trigger%rowtype;
  v_tags text[] := array['CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO'];
begin
  select * into v_trigger
  from pg_catalog.pg_event_trigger
  where evtname = 'ensure_rls';

  if found then
    if v_trigger.evtfoid <> 'public.rls_auto_enable()'::regprocedure
       or v_trigger.evtevent <> 'ddl_command_end'
       or v_trigger.evttags is distinct from v_tags then
      raise exception 'El event trigger ensure_rls existe con una definición diferente.';
    end if;
    if v_trigger.evtenabled <> 'O' then
      execute 'alter event trigger ensure_rls enable';
    end if;
  else
    execute $ddl$
      create event trigger ensure_rls
      on ddl_command_end
      when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      execute function public.rls_auto_enable()
    $ddl$;
  end if;
end;
$block$;

revoke all on function public.rls_auto_enable() from public, anon, authenticated;
commit;
