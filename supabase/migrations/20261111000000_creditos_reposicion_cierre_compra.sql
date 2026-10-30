-- Fase E06-E10: seguimiento documental de créditos, compensación referenciada,
-- reposiciones como nuevas recepciones y resumen operativo/financiero de cierre.
-- Aplicación manual; D11: devoluciones y compensaciones no editan CxP.
begin;

alter table public.devoluciones_compra
  add column if not exists referencia_documental text,
  add column if not exists estado_credito text not null default 'Pendiente',
  add column if not exists seguimiento_actualizado_por uuid references public.usuarios(id) on delete set null,
  add column if not exists seguimiento_actualizado_en timestamptz;
alter table public.devoluciones_compra drop constraint if exists devoluciones_compra_estado_credito_ck;
alter table public.devoluciones_compra add constraint devoluciones_compra_estado_credito_ck
  check(estado_credito in ('Pendiente','Aplicado','Repuesto'));
alter table public.devoluciones_compra drop constraint if exists devoluciones_compra_referencia_documental_ck;
alter table public.devoluciones_compra add constraint devoluciones_compra_referencia_documental_ck
  check(referencia_documental is null or length(trim(referencia_documental)) between 1 and 120);

create table if not exists public.reversiones_devolucion_compra (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique default ('RVD-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
  devolucion_id uuid not null references public.devoluciones_compra(id) on delete restrict,
  motivo text not null check(length(trim(motivo)) between 3 and 1000),
  idempotency_key text not null unique,
  payload_hash text not null,
  created_by uuid not null default auth.uid() references public.usuarios(id) on delete restrict,
  created_at timestamptz not null default now()
);
create table if not exists public.detalle_reversiones_devolucion_compra (
  id uuid primary key default gen_random_uuid(),
  reversion_id uuid not null references public.reversiones_devolucion_compra(id) on delete restrict,
  detalle_devolucion_id uuid not null references public.detalle_devoluciones_compra(id) on delete restrict,
  producto_id uuid not null references public.productos(id) on delete restrict,
  almacen_id uuid not null references public.almacenes(id) on delete restrict,
  cantidad integer not null check(cantidad>0),
  costo_unitario numeric(14,2) not null check(costo_unitario>=0),
  created_at timestamptz not null default now(),
  unique(reversion_id,detalle_devolucion_id)
);
create index if not exists reversiones_devolucion_compra_origen_idx
  on public.reversiones_devolucion_compra(devolucion_id,created_at desc,id desc);
create index if not exists detalle_reversiones_devolucion_origen_idx
  on public.detalle_reversiones_devolucion_compra(detalle_devolucion_id);

alter table public.detalle_recepciones_compra
  add column if not exists reposicion_devolucion_detalle_id uuid references public.detalle_devoluciones_compra(id) on delete restrict;
create index if not exists detalle_recepciones_reposicion_origen_idx
  on public.detalle_recepciones_compra(reposicion_devolucion_detalle_id)
  where reposicion_devolucion_detalle_id is not null;

alter table public.reversiones_devolucion_compra enable row level security;
alter table public.detalle_reversiones_devolucion_compra enable row level security;
grant select on public.reversiones_devolucion_compra,public.detalle_reversiones_devolucion_compra to authenticated;
drop policy if exists reversiones_devolucion_compra_select on public.reversiones_devolucion_compra;
create policy reversiones_devolucion_compra_select on public.reversiones_devolucion_compra for select to authenticated
  using((select app_private._tiene_permiso('compras','ver')));
drop policy if exists detalle_reversiones_devolucion_compra_select on public.detalle_reversiones_devolucion_compra;
create policy detalle_reversiones_devolucion_compra_select on public.detalle_reversiones_devolucion_compra for select to authenticated
  using((select app_private._tiene_permiso('compras','ver')));

create or replace function app_private._validar_reposicion_devolucion_compra_v1(
  p_compra_id uuid,p_detalle_compra_id uuid,p_detalle_devolucion_id uuid,p_cantidad integer
)
returns void language plpgsql security definer set search_path = '' as $function$
declare v_documented integer; v_reversed integer; v_replenished integer;
begin
  if p_detalle_devolucion_id is null or p_cantidad is null or p_cantidad<=0 then
    raise exception 'La reposición requiere una línea de devolución y cantidad positiva.' using errcode='22023';
  end if;
  select d.cantidad into v_documented
  from public.detalle_devoluciones_compra d
  join public.devoluciones_compra h on h.id=d.devolucion_id
  join public.detalle_recepciones_compra dr on dr.id=d.detalle_recepcion_id
  where d.id=p_detalle_devolucion_id and h.compra_id=p_compra_id and dr.detalle_compra_id=p_detalle_compra_id
  for update of d;
  if not found then raise exception 'La reposición debe referenciar una devolución documentada de la misma orden y línea.' using errcode='23503'; end if;
  select coalesce(sum(x.cantidad),0)::integer into v_reversed
    from public.detalle_reversiones_devolucion_compra x where x.detalle_devolucion_id=p_detalle_devolucion_id;
  select coalesce(sum(x.cantidad),0)::integer into v_replenished
    from public.detalle_recepciones_compra x where x.reposicion_devolucion_detalle_id=p_detalle_devolucion_id;
  if p_cantidad>greatest(v_documented-v_reversed-v_replenished,0) then
    raise exception 'La reposición supera la devolución documentada pendiente (% disponibles).',greatest(v_documented-v_reversed-v_replenished,0) using errcode='23514';
  end if;
end
$function$;
revoke all on function app_private._validar_reposicion_devolucion_compra_v1(uuid,uuid,uuid,integer) from public,anon,authenticated;

-- Extiende el RPC transaccional de recepción: una línea marcada como reposición
-- supera el tope original solo hasta la cantidad devuelta y aún no repuesta.
do $patch_receipt_replenishment$
declare
  v_definition text;
  v_old_limit text := 'if v_recibido+v_cantidad>v_dc.cantidad then raise exception ''La recepción excede la cantidad ordenada.'' using errcode=''23514''; end if;';
  v_new_limit text := 'if nullif(v_line->>''devolucion_detalle_id'','''') is not null then perform app_private._validar_reposicion_devolucion_compra_v1(p_compra_id,v_dc.id,(v_line->>''devolucion_detalle_id'')::uuid,v_cantidad); elsif v_recibido+v_cantidad>v_dc.cantidad then raise exception ''La recepción excede la cantidad ordenada.'' using errcode=''23514''; end if;';
  v_old_insert text := 'insert into public.detalle_recepciones_compra(recepcion_id,detalle_compra_id,producto_id,cantidad,costo_unitario) values(v_recepcion,v_dc.id,v_producto,v_cantidad,v_dc.costo_unitario);';
  v_new_insert text := 'insert into public.detalle_recepciones_compra(recepcion_id,detalle_compra_id,producto_id,cantidad,costo_unitario,reposicion_devolucion_detalle_id) values(v_recepcion,v_dc.id,v_producto,v_cantidad,v_dc.costo_unitario,nullif(v_line->>''devolucion_detalle_id'','''')::uuid);';
begin
  select pg_get_functiondef('app_private._registrar_recepcion_compra_v2(uuid,uuid,jsonb,text,text,text,text)'::regprocedure)
    into v_definition;
  if position(v_new_limit in v_definition)>0 and position(v_new_insert in v_definition)>0 then return; end if;
  if position(v_old_limit in v_definition)=0 or position(v_old_insert in v_definition)=0 then
    raise exception 'No se reconoció el RPC transaccional de recepción para habilitar reposiciones; migración abortada.';
  end if;
  v_definition:=replace(v_definition,v_old_limit,v_new_limit);
  v_definition:=replace(v_definition,v_old_insert,v_new_insert);
  execute v_definition;
end
$patch_receipt_replenishment$;

-- Una compensación revierte físicamente el retorno original: debe descontar el
-- devuelto efectivo para netos y permitir una devolución posterior si procede.
do $patch_effective_returns$
declare
  v_definition text;
  v_old text := 'select coalesce(sum(d.cantidad),0)::integer into v_devuelto
    from public.detalle_devoluciones_compra d join public.devoluciones_compra h on h.id=d.devolucion_id
    where d.detalle_recepcion_id=v_detalle;';
  v_new text := 'select greatest(coalesce(sum(d.cantidad),0)-coalesce((select sum(x.cantidad) from public.detalle_reversiones_devolucion_compra x where x.detalle_devolucion_id in (select d2.id from public.detalle_devoluciones_compra d2 where d2.detalle_recepcion_id=v_detalle)),0),0)::integer into v_devuelto
    from public.detalle_devoluciones_compra d join public.devoluciones_compra h on h.id=d.devolucion_id
    where d.detalle_recepcion_id=v_detalle;';
  v_done text := 'select greatest(coalesce(sum(d.cantidad),0)-coalesce((select sum(x.cantidad) from public.detalle_reversiones_devolucion_compra x where x.detalle_devolucion_id in (select d2.id from public.detalle_devoluciones_compra d2 where d2.detalle_recepcion_id=v_detalle)),0),0)::integer into v_devuelto';
begin
  select pg_get_functiondef('public.registrar_devolucion_compra(uuid,text,jsonb,text)'::regprocedure) into v_definition;
  if position(v_done in v_definition)>0 then return; end if;
  if position(v_old in v_definition)=0 then raise exception 'No se reconoció el límite del RPC de devolución para incorporar compensaciones.'; end if;
  execute replace(v_definition,v_old,v_new);
end
$patch_effective_returns$;

do $patch_receipt_net_summary$
declare
  v_definition text;
  v_old text := '(select coalesce(sum(dd.cantidad),0)::integer
       from public.detalle_devoluciones_compra dd
       join public.detalle_recepciones_compra dr2 on dr2.id=dd.detalle_recepcion_id
       join public.recepciones_compra r2 on r2.id=dr2.recepcion_id
       where dr2.detalle_compra_id=dc.id and r2.compra_id=p_compra_id) as devuelto';
  v_new text := '(select greatest(coalesce(sum(dd.cantidad),0)-coalesce((select sum(rx.cantidad) from public.detalle_reversiones_devolucion_compra rx where rx.detalle_devolucion_id in (select d2.id from public.detalle_devoluciones_compra d2 join public.detalle_recepciones_compra drx on drx.id=d2.detalle_recepcion_id where drx.detalle_compra_id=dc.id)),0),0)::integer
       from public.detalle_devoluciones_compra dd
       join public.detalle_recepciones_compra dr2 on dr2.id=dd.detalle_recepcion_id
       join public.recepciones_compra r2 on r2.id=dr2.recepcion_id
       where dr2.detalle_compra_id=dc.id and r2.compra_id=p_compra_id) as devuelto';
  v_done text := 'from public.detalle_reversiones_devolucion_compra rx where rx.detalle_devolucion_id in (select d2.id';
begin
  select pg_get_functiondef('public.obtener_resumen_recepcion_compra_v1(uuid)'::regprocedure) into v_definition;
  if position(v_done in v_definition)>0 then return; end if;
  if position(v_old in v_definition)=0 then raise exception 'No se reconoció el cálculo de neto del RPC de recepciones.'; end if;
  execute replace(v_definition,v_old,v_new);
end
$patch_receipt_net_summary$;

create or replace function public.actualizar_seguimiento_credito_devolucion_v1(
  p_devolucion_id uuid,p_referencia_documental text,p_estado_credito text
)
returns void language plpgsql security definer set search_path = '' as $function$
begin
  if (select auth.uid()) is null or not (select app_private._tiene_permiso('compras','editar')) then
    raise exception 'Se requiere permiso de edición de Compras para actualizar el seguimiento documental.' using errcode='42501';
  end if;
  if p_devolucion_id is null or p_estado_credito is null or p_estado_credito not in ('Pendiente','Aplicado','Repuesto')
     or (p_referencia_documental is not null and length(trim(p_referencia_documental)) not between 1 and 120) then
    raise exception 'Estado o referencia documental inválidos.' using errcode='22023';
  end if;
  if p_estado_credito='Repuesto' and (
    not exists(select 1 from public.detalle_devoluciones_compra d where d.devolucion_id=p_devolucion_id
      and coalesce((select sum(x.cantidad) from public.detalle_recepciones_compra x where x.reposicion_devolucion_detalle_id=d.id),0)>0)
    or exists(select 1 from public.detalle_devoluciones_compra d where d.devolucion_id=p_devolucion_id and
      greatest(d.cantidad-coalesce((select sum(x.cantidad) from public.detalle_reversiones_devolucion_compra x where x.detalle_devolucion_id=d.id),0),0)>
        coalesce((select sum(x.cantidad) from public.detalle_recepciones_compra x where x.reposicion_devolucion_detalle_id=d.id),0))
  ) then raise exception 'El documento debe tener una reposición registrada completa antes de marcarse como Repuesto.' using errcode='23514'; end if;
  update public.devoluciones_compra set referencia_documental=nullif(trim(p_referencia_documental),''),
    estado_credito=p_estado_credito,seguimiento_actualizado_por=(select auth.uid()),
    seguimiento_actualizado_en=clock_timestamp() where id=p_devolucion_id;
  if not found then raise exception 'La devolución no existe.' using errcode='23503'; end if;
  -- Este RPC solo actualiza metadatos de Compras; no escribe CxP ni Tesorería.
end
$function$;

create or replace function public.compensar_devolucion_compra_v1(
  p_devolucion_id uuid,p_motivo text,p_lineas jsonb,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid:=(select auth.uid()); v_hash text; v_id uuid; v_old public.reversiones_devolucion_compra%rowtype;
  v_line jsonb; v_detail uuid; v_quantity integer; v_original integer; v_reversed integer; v_replenished integer;
  v_product uuid; v_warehouse uuid; v_cost numeric(14,2); v_purchase uuid;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','editar'))
     or not ((select app_private._tiene_permiso('inventario','crear')) or (select app_private._tiene_permiso('inventario','editar'))) then
    raise exception 'Se requiere permiso de edición de Compras y de Inventario.' using errcode='42501';
  end if;
  if p_devolucion_id is null or length(trim(coalesce(p_motivo,''))) not between 3 and 1000
     or p_lineas is null or jsonb_typeof(p_lineas) is distinct from 'array' or jsonb_array_length(p_lineas)=0
     or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key)>180 then
    raise exception 'La compensación requiere devolución original, motivo, líneas y clave idempotente válidos.' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_lineas) e where jsonb_typeof(e.value) is distinct from 'object'
      or nullif(e.value->>'detalle_devolucion_id','') is null or coalesce(e.value->>'cantidad','') !~ '^[0-9]+$')
     or (select count(distinct value->>'detalle_devolucion_id') from jsonb_array_elements(p_lineas))<>jsonb_array_length(p_lineas) then
    raise exception 'Líneas de compensación inválidas o duplicadas.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('devolucion_id',p_devolucion_id,'motivo',trim(p_motivo),'lineas',p_lineas)::text);
  perform pg_advisory_xact_lock(hashtextextended('reversion-devolucion:'||p_idempotency_key,0));
  select * into v_old from public.reversiones_devolucion_compra where idempotency_key=p_idempotency_key;
  if found then
    if v_old.payload_hash<>v_hash then raise exception 'La clave ya se usó con otros datos.' using errcode='23505'; end if;
    return v_old.id;
  end if;
  perform 1 from public.devoluciones_compra where id=p_devolucion_id for update;
  if not found then raise exception 'La devolución original no existe.' using errcode='23503'; end if;
  select compra_id into v_purchase from public.devoluciones_compra where id=p_devolucion_id;
  insert into public.reversiones_devolucion_compra(devolucion_id,motivo,idempotency_key,payload_hash,created_by)
    values(p_devolucion_id,trim(p_motivo),p_idempotency_key,v_hash,v_uid) returning id into v_id;
  for v_line in select value from jsonb_array_elements(p_lineas) order by value->>'detalle_devolucion_id' loop
    v_detail:=(v_line->>'detalle_devolucion_id')::uuid;
    v_quantity:=(v_line->>'cantidad')::integer;
    if v_quantity<=0 then raise exception 'La cantidad a compensar debe ser mayor que cero.' using errcode='22023'; end if;
    select d.cantidad,d.producto_id,d.almacen_id,d.costo_unitario into v_original,v_product,v_warehouse,v_cost
      from public.detalle_devoluciones_compra d where d.id=v_detail and d.devolucion_id=p_devolucion_id for update;
    if not found then raise exception 'La línea no pertenece a la devolución original.' using errcode='23503'; end if;
    select coalesce(sum(x.cantidad),0)::integer into v_reversed
      from public.detalle_reversiones_devolucion_compra x join public.reversiones_devolucion_compra h on h.id=x.reversion_id
      where x.detalle_devolucion_id=v_detail and h.id<>v_id;
    select coalesce(sum(x.cantidad),0)::integer into v_replenished
      from public.detalle_recepciones_compra x where x.reposicion_devolucion_detalle_id=v_detail;
    if v_reversed+v_replenished+v_quantity>v_original then
      raise exception 'No se puede compensar más de lo devuelto aún vigente y no repuesto (% disponibles).',greatest(v_original-v_reversed-v_replenished,0) using errcode='23514';
    end if;
    insert into public.detalle_reversiones_devolucion_compra(reversion_id,detalle_devolucion_id,producto_id,almacen_id,cantidad,costo_unitario)
      values(v_id,v_detail,v_product,v_warehouse,v_quantity,v_cost);
    perform public.registrar_movimiento_inventario(v_product,v_warehouse,'entrada',v_quantity,
      'Compensación de devolución '||p_devolucion_id::text,p_idempotency_key||':'||v_detail::text,
      'reversion_devolucion_compra',v_id,trim(p_motivo));
  end loop;
  -- Evento compensatorio append-only: la devolución y su Kardex original se conservan.
  return v_id;
end
$function$;

-- Actualiza el resumen de disponibilidad: neto y stock siguen independientes;
-- pendiente de reposición excluye las cantidades compensadas y ya recibidas.
create or replace function public.listar_lineas_devolucion_compra_v1(p_compra_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_items jsonb;
begin
  if (select auth.uid()) is null or not (select app_private._tiene_permiso('compras','ver')) then raise exception 'No tienes permiso para consultar devoluciones.' using errcode='42501'; end if;
  if not exists(select 1 from public.compras where id=p_compra_id) then raise exception 'La orden no existe.' using errcode='23503'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',dr.id,'detalle_compra_id',dr.detalle_compra_id,'cantidad',dr.cantidad,'recibido_en_evento',dr.cantidad,
    'producto_id',dr.producto_id,'costo_unitario',dr.costo_unitario,'descripcion',coalesce(pp.nombre,dc.descripcion),
    'recibido_bruto',gross.total,'devuelto',returned.total,'neto_recibido',gross.total-returned.total,
    'stock_disponible',greatest(coalesce(inv.cantidad,0),0),
    'maximo_retornable',least(greatest(dr.cantidad-event_returned.total,0),greatest(coalesce(inv.cantidad,0),0)),
    'cantidad_repuesta',replenished.total,'pendiente_reposicion',greatest(doc_returned.total-reversed.total-replenished.total,0),
    'recepcion_id',r.id,'recepcion_codigo',r.codigo,'almacen_id',r.almacen_id,'almacen',a.nombre,'recibido_en',r.recibido_en)
    order by r.recibido_en desc,dr.id),'[]'::jsonb)
  into v_items from public.detalle_recepciones_compra dr
  join public.recepciones_compra r on r.id=dr.recepcion_id
  join public.detalle_compras dc on dc.id=dr.detalle_compra_id
  left join public.proveedor_productos pp on pp.id=dc.proveedor_producto_id
  join public.almacenes a on a.id=r.almacen_id
  left join public.inventarios inv on inv.producto_id=dr.producto_id and inv.almacen_id=r.almacen_id
  cross join lateral (select coalesce(sum(dr0.cantidad),0)::integer as total from public.detalle_recepciones_compra dr0 where dr0.detalle_compra_id=dr.detalle_compra_id) gross
  cross join lateral (select greatest(coalesce(sum(dd0.cantidad),0)-coalesce((select sum(rx.cantidad) from public.detalle_reversiones_devolucion_compra rx where rx.detalle_devolucion_id in
    (select ddx.id from public.detalle_devoluciones_compra ddx join public.detalle_recepciones_compra drx on drx.id=ddx.detalle_recepcion_id where drx.detalle_compra_id=dr.detalle_compra_id)),0),0)::integer as total
    from public.detalle_recepciones_compra dr0 join public.detalle_devoluciones_compra dd0 on dd0.detalle_recepcion_id=dr0.id where dr0.detalle_compra_id=dr.detalle_compra_id) returned
  cross join lateral (select greatest(coalesce(sum(dd.cantidad),0)-coalesce((select sum(rx.cantidad) from public.detalle_reversiones_devolucion_compra rx where rx.detalle_devolucion_id in
    (select ddx.id from public.detalle_devoluciones_compra ddx where ddx.detalle_recepcion_id=dr.id)),0),0)::integer as total from public.detalle_devoluciones_compra dd where dd.detalle_recepcion_id=dr.id) event_returned
  cross join lateral (select coalesce(sum(x.cantidad),0)::integer as total from public.detalle_recepciones_compra x where x.reposicion_devolucion_detalle_id in
    (select d.id from public.detalle_devoluciones_compra d where d.detalle_recepcion_id=dr.id)) replenished
  cross join lateral (select coalesce(sum(d.cantidad),0)::integer as total from public.detalle_devoluciones_compra d where d.detalle_recepcion_id=dr.id) doc_returned
  cross join lateral (select coalesce(sum(x.cantidad),0)::integer as total from public.detalle_reversiones_devolucion_compra x where x.detalle_devolucion_id in
    (select d.id from public.detalle_devoluciones_compra d where d.detalle_recepcion_id=dr.id)) reversed
  where r.compra_id=p_compra_id;
  return v_items;
end
$function$;

-- Resumen de cierre: fuente de operación (recepciones) y fuente financiera
-- (cuentas/aplicaciones Tesorería) se consultan por separado y respetan permisos.
create or replace function public.obtener_resumen_cierre_compra_v1(p_compra_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_receipts jsonb; v_payments jsonb:='[]'::jsonb; v_visible boolean; v_gross bigint; v_returned bigint;
begin
  if (select auth.uid()) is null or not (select app_private._tiene_permiso('compras','ver')) then raise exception 'No tienes permiso para consultar órdenes.' using errcode='42501'; end if;
  if not exists(select 1 from public.compras where id=p_compra_id) then raise exception 'La orden no existe.' using errcode='23503'; end if;
  select public.obtener_resumen_recepcion_compra_v1(p_compra_id) into v_receipts;
  select coalesce(sum((x->>'recibido_bruto')::bigint),0),coalesce(sum((x->>'devuelto')::bigint),0)
    into v_gross,v_returned from jsonb_array_elements(v_receipts) x;
  v_visible:=coalesce((select app_private._tiene_permiso('finanzas','ver')),false);
  if v_visible then
    select coalesce(jsonb_agg(jsonb_build_object('cuenta_id',p.id,'codigo',p.codigo,'estado',p.estado::text,'moneda',coalesce(p.moneda,'PEN'),
      'monto_original',s.monto_original,'monto_aplicado',s.monto_aplicado,'saldo_pendiente',s.saldo_pendiente) order by p.created_at,p.id),'[]'::jsonb)
    into v_payments from public.pagos p
    cross join lateral public.obtener_saldos_cuentas(array[p.id]) s
    where p.compra_id=p_compra_id and p.tipo='pagar';
  end if;
  return jsonb_build_object('recepciones_por_linea',v_receipts,'recibido_bruto',v_gross,'devuelto',v_returned,
    'neto_recibido',v_gross-v_returned,'financiera_visible',v_visible,'pagos',v_payments);
end
$function$;

create or replace function public.listar_pendientes_reposicion_compra_v1(p_compra_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_items jsonb;
begin
  if (select auth.uid()) is null or not (select app_private._tiene_permiso('compras','ver')) then raise exception 'No tienes permiso para consultar reposiciones.' using errcode='42501'; end if;
  if not exists(select 1 from public.compras where id=p_compra_id) then raise exception 'La orden no existe.' using errcode='23503'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('detalle_devolucion_id',d.id,'detalle_compra_id',dr.detalle_compra_id,
    'devolucion_id',h.id,'devolucion_codigo',h.codigo,'referencia_documental',h.referencia_documental,
    'descripcion',coalesce(pp.nombre,dc.descripcion),'producto_id',d.producto_id,'almacen_id',d.almacen_id,
    'almacen',a.nombre,'cantidad_devuelta',d.cantidad,'cantidad_compensada',rev.total,
    'cantidad_repuesta',rep.total,'pendiente_reposicion',greatest(d.cantidad-rev.total-rep.total,0))
    order by h.created_at,d.id),'[]'::jsonb) into v_items
  from public.detalle_devoluciones_compra d
  join public.devoluciones_compra h on h.id=d.devolucion_id
  join public.detalle_recepciones_compra dr on dr.id=d.detalle_recepcion_id
  join public.detalle_compras dc on dc.id=dr.detalle_compra_id
  left join public.proveedor_productos pp on pp.id=dc.proveedor_producto_id
  join public.almacenes a on a.id=d.almacen_id
  cross join lateral (select coalesce(sum(x.cantidad),0)::integer as total from public.detalle_reversiones_devolucion_compra x where x.detalle_devolucion_id=d.id) rev
  cross join lateral (select coalesce(sum(x.cantidad),0)::integer as total from public.detalle_recepciones_compra x where x.reposicion_devolucion_detalle_id=d.id) rep
  where h.compra_id=p_compra_id and d.cantidad-rev.total-rep.total>0;
  return v_items;
end
$function$;

create or replace function public.listar_compensaciones_devolucion_compra_v1(p_devolucion_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_items jsonb;
begin
  if (select auth.uid()) is null or not (select app_private._tiene_permiso('compras','ver')) then raise exception 'No tienes permiso para consultar compensaciones.' using errcode='42501'; end if;
  if not exists(select 1 from public.devoluciones_compra where id=p_devolucion_id) then raise exception 'La devolución original no existe.' using errcode='23503'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'codigo',h.codigo,'motivo',h.motivo,'created_at',h.created_at,
    'actor_id',h.created_by,'actor',u.nombre,'lineas',h.lineas) order by h.created_at desc,h.id desc),'[]'::jsonb)
  into v_items from (
    select r.id,r.codigo,r.motivo,r.created_at,r.created_by,
      (select coalesce(jsonb_agg(jsonb_build_object('detalle_devolucion_id',d.detalle_devolucion_id,
        'cantidad',d.cantidad,'producto_id',d.producto_id,'almacen_id',d.almacen_id,
        'almacen',a.nombre,'movimiento_kardex_id',m.id,'movimiento_kardex_fecha',m.created_at) order by d.id),'[]'::jsonb)
       from public.detalle_reversiones_devolucion_compra d join public.almacenes a on a.id=d.almacen_id
       left join lateral(select mi.id,mi.created_at from public.movimientos_inventario mi
         where mi.origen_tipo='reversion_devolucion_compra' and mi.origen_id=r.id
          and mi.idempotency_key like '%'||d.detalle_devolucion_id::text order by mi.created_at desc limit 1) m on true
       where d.reversion_id=r.id) as lineas
    from public.reversiones_devolucion_compra r where r.devolucion_id=p_devolucion_id
  ) h left join public.usuarios u on u.id=h.created_by;
  return v_items;
end
$function$;

create or replace function public.obtener_seguimiento_creditos_devolucion_v1(p_devolucion_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
begin
  if (select auth.uid()) is null or not (select app_private._tiene_permiso('compras','ver')) then raise exception 'No tienes permiso para consultar el seguimiento documental.' using errcode='42501'; end if;
  if coalesce(array_length(p_devolucion_ids,1),0)>100 then raise exception 'Solicita como máximo 100 documentos por consulta.' using errcode='22023'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'referencia_documental',h.referencia_documental,
    'estado_credito',h.estado_credito,'seguimiento_actualizado_por',h.seguimiento_actualizado_por,
    'seguimiento_actualizado_en',h.seguimiento_actualizado_en) order by h.id)
    from public.devoluciones_compra h where h.id=any(coalesce(p_devolucion_ids,'{}'::uuid[]))),'[]'::jsonb);
end
$function$;

revoke all on function public.actualizar_seguimiento_credito_devolucion_v1(uuid,text,text) from public,anon;
revoke all on function public.compensar_devolucion_compra_v1(uuid,text,jsonb,text) from public,anon;
revoke all on function public.obtener_resumen_cierre_compra_v1(uuid) from public,anon;
revoke all on function public.listar_pendientes_reposicion_compra_v1(uuid) from public,anon;
revoke all on function public.listar_compensaciones_devolucion_compra_v1(uuid) from public,anon;
revoke all on function public.obtener_seguimiento_creditos_devolucion_v1(uuid[]) from public,anon;
grant execute on function public.actualizar_seguimiento_credito_devolucion_v1(uuid,text,text) to authenticated;
grant execute on function public.compensar_devolucion_compra_v1(uuid,text,jsonb,text) to authenticated;
grant execute on function public.obtener_resumen_cierre_compra_v1(uuid) to authenticated;
grant execute on function public.listar_pendientes_reposicion_compra_v1(uuid) to authenticated;
grant execute on function public.listar_compensaciones_devolucion_compra_v1(uuid) to authenticated;
grant execute on function public.obtener_seguimiento_creditos_devolucion_v1(uuid[]) to authenticated;

do $audit$
begin
  if to_regprocedure('public.fn_auditar()') is not null then
    if not exists(select 1 from pg_trigger where tgrelid='public.reversiones_devolucion_compra'::regclass and tgfoid='public.fn_auditar()'::regprocedure and not tgisinternal) then
      execute 'create trigger trg_auditoria_reversion_devolucion after insert on public.reversiones_devolucion_compra for each row execute function public.fn_auditar()';
    end if;
  end if;
end
$audit$;

commit;
