-- Edición atómica de orden, con control optimista y bloqueo de líneas recibidas.
-- Preparada para revisión/aplicación manual en el proyecto remoto de desarrollo.
begin;

create or replace function app_private._editar_orden_compra_operativa_v1(
  p_compra_id uuid,
  p_expected_updated_at timestamptz,
  p_proveedor_id uuid,
  p_detalle text,
  p_fecha_limite date,
  p_comprobante_tipo text,
  p_comprobante_numero text,
  p_lineas jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_compra public.compras%rowtype;
  v_line jsonb;
  v_line_id uuid;
  v_catalogo_id uuid;
  v_qty integer;
  v_cost numeric(14,2);
  v_total numeric(14,2) := 0;
  v_proveedor_nombre text;
  v_count integer;
begin
  if v_uid is null or not (select public.tiene_permiso('compras','editar')) then
    raise exception 'Se requiere permiso para editar compras.' using errcode='42501';
  end if;
  if p_compra_id is null or p_expected_updated_at is null or p_proveedor_id is null
     or p_lineas is null or jsonb_typeof(p_lineas)<>'array' then
    raise exception 'La solicitud de edición está incompleta o no es válida.' using errcode='22023';
  end if;

  select * into v_compra from public.compras where id=p_compra_id for update;
  if not found then raise exception 'La orden no existe.' using errcode='23503'; end if;
  if v_compra.updated_at is distinct from p_expected_updated_at then
    raise exception 'La orden cambió desde que la abriste. Recarga antes de guardar.' using errcode='40001';
  end if;
  if exists(select 1 from public.recepciones_compra where compra_id=p_compra_id) then
    raise exception 'La orden ya tiene una recepción. No se pueden editar sus líneas; registra una recepción adicional o devolución.' using errcode='23514';
  end if;
  if v_compra.estado::text in ('Cancelada','Rechazada','Pagada') then
    raise exception 'No se puede editar una orden cancelada, rechazada o pagada.' using errcode='23514';
  end if;

  select razon_social into v_proveedor_nombre from public.proveedores where id=p_proveedor_id for share;
  if not found then raise exception 'El proveedor ya no existe.' using errcode='23503'; end if;
  if (select count(*) from (select value->>'producto_id' from jsonb_array_elements(p_lineas) group by value->>'producto_id') x)
      <> jsonb_array_length(p_lineas) then
    raise exception 'Un artículo solo puede aparecer una vez en la orden.' using errcode='22023';
  end if;

  -- Valida todo antes de persistir. Cualquier error revierte cabecera y líneas.
  for v_line in select value from jsonb_array_elements(p_lineas) loop
    v_line_id := nullif(v_line->>'detalle_compra_id','')::uuid;
    v_catalogo_id := nullif(v_line->>'producto_id','')::uuid;
    v_qty := nullif(v_line->>'cantidad','')::integer;
    v_cost := nullif(v_line->>'precio','')::numeric;
    if v_catalogo_id is null or v_qty is null or v_qty<=0 or v_cost is null or v_cost<0
       or v_cost::text in ('NaN','Infinity','-Infinity') then
      raise exception 'Una línea tiene artículo, cantidad o costo no válido.' using errcode='22023';
    end if;
    if not exists(select 1 from public.proveedor_productos where id=v_catalogo_id and proveedor_id=p_proveedor_id and producto_id is not null) then
      raise exception 'Un artículo no pertenece al proveedor o no está vinculado al inventario.' using errcode='23503';
    end if;
    if v_line_id is not null and not exists(select 1 from public.detalle_compras where id=v_line_id and compra_id=p_compra_id) then
      raise exception 'Una línea no pertenece a esta orden.' using errcode='23503';
    end if;
    v_total := v_total + v_qty*v_cost;
  end loop;
  if jsonb_array_length(p_lineas)>0 and v_total<=0 then
    raise exception 'El total de las líneas debe ser mayor que cero.' using errcode='22023';
  end if;
  if jsonb_array_length(p_lineas)=0 and coalesce(v_compra.monto,0)<=0 then
    raise exception 'La orden debe conservar un importe mayor que cero.' using errcode='22023';
  end if;

  update public.compras set proveedor_id=p_proveedor_id, proveedor_nombre=v_proveedor_nombre,
    detalle=coalesce(trim(p_detalle),''), monto=case when jsonb_array_length(p_lineas)>0 then round(v_total,2) else monto end,
    fecha_limite=p_fecha_limite, comprobante_tipo=nullif(trim(p_comprobante_tipo),''),
    comprobante_numero=nullif(trim(p_comprobante_numero),''), updated_at=clock_timestamp()
  where id=p_compra_id returning * into v_compra;

  -- Reemplaza el conjunto solo en esta transacción; ningún detalle recibido puede existir aquí.
  delete from public.detalle_compras where compra_id=p_compra_id;
  for v_line in select value from jsonb_array_elements(p_lineas) loop
    v_catalogo_id := (v_line->>'producto_id')::uuid;
    v_qty := (v_line->>'cantidad')::integer;
    v_cost := round((v_line->>'precio')::numeric,2);
    insert into public.detalle_compras(compra_id,proveedor_producto_id,cantidad,costo_unitario)
    values(p_compra_id,v_catalogo_id,v_qty,v_cost);
  end loop;

  return jsonb_build_object('compra_id',v_compra.id,'codigo',v_compra.codigo,'updated_at',v_compra.updated_at,
    'version',1,'monto',v_compra.monto);
end
$function$;

revoke all on function app_private._editar_orden_compra_operativa_v1(uuid,timestamptz,uuid,text,date,text,text,jsonb) from public,anon;
grant execute on function app_private._editar_orden_compra_operativa_v1(uuid,timestamptz,uuid,text,date,text,text,jsonb) to authenticated;

create or replace function public.editar_orden_compra_operativa_v1(
  p_compra_id uuid,
  p_expected_updated_at timestamptz,
  p_proveedor_id uuid,
  p_detalle text,
  p_fecha_limite date,
  p_comprobante_tipo text,
  p_comprobante_numero text,
  p_lineas jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $wrapper$
  select app_private._editar_orden_compra_operativa_v1($1,$2,$3,$4,$5,$6,$7,$8)
$wrapper$;

revoke all on function public.editar_orden_compra_operativa_v1(uuid,timestamptz,uuid,text,date,text,text,jsonb) from public,anon;
grant execute on function public.editar_orden_compra_operativa_v1(uuid,timestamptz,uuid,text,date,text,text,jsonb) to authenticated;

commit;
