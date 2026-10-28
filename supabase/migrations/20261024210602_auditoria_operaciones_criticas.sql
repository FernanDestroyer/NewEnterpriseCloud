-- Extiende la bitácora existente a todas las tablas de negocio y configuración.
-- No borra datos; cada evento conserva antes/después y el actor autenticado.
create or replace function public.fn_auditar()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_uid uuid := (select auth.uid());
  v_registro_id text;
begin
  v_registro_id := coalesce(
    v_row->>'codigo',
    v_row->>'id',
    nullif(concat_ws(':', nullif(v_row->>'zona_id', ''), nullif(v_row->>'cliente_id', '')), ''),
    nullif(concat_ws(':', nullif(v_row->>'zona_id', ''), nullif(v_row->>'sucursal_id', '')), ''),
    nullif(concat_ws(':', nullif(v_row->>'usuario_id', ''), nullif(v_row->>'permiso_id', '')), ''),
    nullif(concat_ws(':', nullif(v_row->>'rol_id', ''), nullif(v_row->>'permiso_id', '')), '')
  );

  insert into public.auditoria
    (usuario_id, usuario_email, accion, modulo, registro_id, datos_antes, datos_despues)
  values
    (v_uid,
     (select u.email from public.usuarios u where u.id = v_uid),
     tg_op,
     tg_table_name,
     v_registro_id,
     case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
     case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return null;
end
$function$;

do $migration$
declare
  v_table text;
begin
  foreach v_table in array array[
    'almacenes', 'analisis_proyectos', 'aperturas_inventario', 'aplicaciones_pago',
    'caja_turnos', 'categorias', 'detalle_compras', 'detalle_cotizaciones',
    'detalle_recepciones_compra', 'detalle_ventas', 'empresas', 'inventarios',
    'metodos_pago', 'monedas', 'movimientos_inventario', 'movimientos_tesoreria',
    'recepciones_compra', 'rol_permisos', 'roles', 'sucursales', 'unidades_medida',
    'usuario_permisos', 'zonas', 'zonas_clientes', 'zonas_sucursales'
  ] loop
    if to_regclass(format('public.%I', v_table)) is not null
      and not exists (
        select 1
        from pg_trigger t
        where t.tgrelid = to_regclass(format('public.%I', v_table))
          and t.tgfoid = 'public.fn_auditar()'::regprocedure
          and not t.tgisinternal
      ) then
      execute format(
        'create trigger trg_auditoria after insert or update or delete on public.%I for each row execute function public.fn_auditar()',
        v_table
      );
    end if;
  end loop;
end
$migration$;
