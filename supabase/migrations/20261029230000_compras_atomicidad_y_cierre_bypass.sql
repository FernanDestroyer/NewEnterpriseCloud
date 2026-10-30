-- B06-B09: importación histórica de compras por lote y escrituras operativas
-- exclusivamente mediante RPC transaccionales.
begin;

-- B06: el lote completo es una sola transacción. Una fila inválida aborta todo.
create or replace function app_private._importar_compras_historicas_v1(p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid := (select auth.uid());
  v_row jsonb;
  v_line integer;
  v_code text;
  v_ref text;
  v_supplier_code text;
  v_supplier_id uuid;
  v_supplier_name text;
  v_detail text;
  v_amount numeric(14,2);
  v_status text;
  v_date date;
  v_due date;
  v_comprobante_tipo text;
  v_comprobante_numero text;
  v_skipped jsonb := '[]'::jsonb;
  v_created integer := 0;
begin
  if v_uid is null or not (
    (select public.tiene_permiso('compras','importar')) or
    (select public.tiene_permiso('compras','crear'))
  ) then raise exception 'Se requiere permiso para importar compras.' using errcode='42501'; end if;
  if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>500 then
    raise exception 'El archivo debe contener una lista de hasta 500 compras.' using errcode='22023';
  end if;
  if exists(
    select 1 from jsonb_to_recordset(p_rows) as x(codigo text)
    group by lower(trim(coalesce(x.codigo,''))) having count(*)>1
  ) then raise exception 'El lote contiene códigos de compra duplicados.' using errcode='22023'; end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_line := nullif(v_row->>'line','')::integer;
    v_code := nullif(trim(v_row->>'codigo'),'');
    v_ref := 'IMP-' || coalesce(v_code,'');
    v_supplier_code := nullif(trim(v_row->>'proveedor_codigo'),'');
    v_supplier_name := nullif(trim(v_row->>'proveedor_nombre'),'');
    v_detail := coalesce(v_row->>'detalle','');
    v_amount := nullif(v_row->>'monto','')::numeric;
    v_status := coalesce(nullif(v_row->>'estado',''),'Solicitud');
    v_date := nullif(v_row->>'fecha','')::date;
    v_due := nullif(v_row->>'fecha_limite','')::date;
    v_comprobante_tipo := nullif(trim(v_row->>'comprobante_tipo'),'');
    v_comprobante_numero := nullif(trim(v_row->>'comprobante_numero'),'');

    if v_line is null or v_code is null or length(v_code)<2 or length(v_code)>100
       or v_supplier_name is null or length(v_supplier_name)<2
       or v_amount is null or v_amount<0 or v_amount::text in ('NaN','Infinity','-Infinity')
       or v_status not in ('Pendiente','Solicitud','Orden','Recibida','Recepción','Factura','Pagada') then
      raise exception 'Línea %: hay campos obligatorios o valores inválidos.',coalesce(v_line,0) using errcode='22023';
    end if;
    if exists(select 1 from public.compras where codigo=v_ref) then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('line',v_line,'reference',v_code,'reason','El código ya fue importado.'));
      continue;
    end if;
    v_supplier_id := null;
    if v_supplier_code is not null then
      select id into v_supplier_id from public.proveedores where codigo=v_supplier_code;
      if not found then raise exception 'Línea %: no existe el proveedor %.',v_line,v_supplier_code using errcode='23503'; end if;
    end if;
    insert into public.compras(
      codigo,proveedor_id,proveedor_nombre,detalle,monto,estado,created_at,fecha_limite,
      comprobante_tipo,comprobante_numero,estado_recepcion,requiere_recepcion,created_by
    ) values (
      v_ref,v_supplier_id,v_supplier_name,v_detail,round(v_amount,2),v_status::public.estado_registro,
      case when v_date is null then now() else v_date::timestamp at time zone 'UTC' end,
      v_due,v_comprobante_tipo,v_comprobante_numero,'completa',false,v_uid
    );
    v_created := v_created+1;
  end loop;
  return jsonb_build_object('created',v_created,'skipped',v_skipped);
end
$function$;

revoke all on function app_private._importar_compras_historicas_v1(jsonb) from public,anon;
grant execute on function app_private._importar_compras_historicas_v1(jsonb) to authenticated;
create or replace function public.importar_compras_historicas_v1(p_rows jsonb)
returns jsonb language sql security invoker set search_path = '' as $wrapper$
  select app_private._importar_compras_historicas_v1($1)
$wrapper$;
revoke all on function public.importar_compras_historicas_v1(jsonb) from public,anon;
grant execute on function public.importar_compras_historicas_v1(jsonb) to authenticated;

-- B09: el cierre de una cuenta solo puede reflejarse en la orden desde un RPC.
create or replace function app_private._marcar_compra_pagada_tesoreria_v1(p_compra_id uuid)
returns text language plpgsql security definer set search_path = '' as $function$
declare v_codigo text;
begin
  if (select auth.uid()) is null or not (select public.tiene_permiso('finanzas','crear')) then
    raise exception 'Se requiere permiso de Tesorería.' using errcode='42501';
  end if;
  if not exists(select 1 from public.pagos where compra_id=p_compra_id and tipo='pagar' and estado_cobro='completa') then
    raise exception 'La cuenta por pagar aún no está cancelada.' using errcode='23514';
  end if;
  update public.compras set estado='Pagada' where id=p_compra_id and estado::text not in ('Cancelada','Rechazada') returning codigo into v_codigo;
  if v_codigo is null then raise exception 'La orden no existe o no puede marcarse como pagada.' using errcode='23503'; end if;
  return v_codigo;
end
$function$;
revoke all on function app_private._marcar_compra_pagada_tesoreria_v1(uuid) from public,anon;
grant execute on function app_private._marcar_compra_pagada_tesoreria_v1(uuid) to authenticated;
create or replace function public.marcar_compra_pagada_tesoreria_v1(p_compra_id uuid)
returns text language sql security invoker set search_path = '' as $wrapper$
  select app_private._marcar_compra_pagada_tesoreria_v1($1)
$wrapper$;
revoke all on function public.marcar_compra_pagada_tesoreria_v1(uuid) from public,anon;
grant execute on function public.marcar_compra_pagada_tesoreria_v1(uuid) to authenticated;

-- RLS deny-by-default for table writes; retain authenticated SELECT policies.
do $lockdown$
declare v_table text; v_policy record;
begin
  foreach v_table in array array[
    'solicitudes_compra','solicitud_compra_lineas','ofertas_compra','detalle_ofertas_compra',
    'devoluciones_compra','detalle_devoluciones_compra',
    'compras','detalle_compras','recepciones_compra','detalle_recepciones_compra'
  ] loop
    execute format('alter table public.%I enable row level security',v_table);
    for v_policy in select policyname,cmd from pg_policies where schemaname='public' and tablename=v_table and cmd<>'SELECT' loop
      execute format('drop policy %I on public.%I',v_policy.policyname,v_table);
    end loop;
    execute format('revoke all on table public.%I from public,anon,authenticated',v_table);
    execute format('grant select on table public.%I to authenticated',v_table);
  end loop;
end
$lockdown$;

commit;
