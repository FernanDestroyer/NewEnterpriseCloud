-- Corrección del comparativo de ofertas: `seleccionar_oferta_compra_v4`
-- referenciaba `x.line_total`, columna que no devuelve
-- `app_private._calcular_impuestos_compra_v1` (devuelve `total`). El error
-- 42703 impedía adjudicar cualquier oferta desde la pantalla de Compras.
--
-- La migración histórica `20261109000000` se conserva intacta; esta migración
-- recrea la función corregida y sus permisos de forma idempotente.
create or replace function public.seleccionar_oferta_compra_v4(
  p_solicitud_id uuid,p_oferta_id uuid,p_motivo text,p_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid:=(select auth.uid()); v_hash text; v_saved app_private.purchase_transition_idempotency%rowtype;
  v_request public.solicitudes_compra%rowtype; v_offer public.ofertas_compra%rowtype;
  v_chosen numeric; v_lowest numeric; v_line_count integer;
begin
  if v_uid is null or not (select app_private._tiene_permiso('compras','editar')) then
    raise exception 'No tienes permiso para seleccionar ofertas.' using errcode='42501';
  end if;
  if p_solicitud_id is null or p_oferta_id is null or length(trim(coalesce(p_motivo,''))) not between 4 and 500
     or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception 'La selecciÃ³n requiere motivo y clave de idempotencia vÃ¡lidos.' using errcode='22023';
  end if;
  v_hash:=md5(jsonb_build_object('solicitud_id',p_solicitud_id,'oferta_id',p_oferta_id,'motivo',trim(p_motivo))::text);
  perform pg_advisory_xact_lock(hashtextextended('purchase-transition:'||p_idempotency_key,0));
  select * into v_saved from app_private.purchase_transition_idempotency where idempotency_key=p_idempotency_key;
  if found then
    if v_saved.operation<>'seleccionar_oferta_con_motivo' or v_saved.payload_hash<>v_hash then raise exception 'Clave usada con otro contenido.' using errcode='23505'; end if;
    return v_saved.result_id;
  end if;
  select * into v_request from public.solicitudes_compra where id=p_solicitud_id for update;
  if not found or v_request.estado<>'Abierta' then raise exception 'La solicitud no estÃ¡ abierta.' using errcode='23514'; end if;
  select * into v_offer from public.ofertas_compra where id=p_oferta_id and solicitud_id=p_solicitud_id
    and estado='Vigente' and es_version_actual for update;
  if not found then raise exception 'Oferta ajena, retirada o no vigente.' using errcode='23514'; end if;
  if v_offer.vigencia_hasta is not null and v_offer.vigencia_hasta<current_date then raise exception 'La oferta estÃ¡ vencida.' using errcode='23514'; end if;
  select count(*) into v_line_count from public.solicitud_compra_lineas where solicitud_id=p_solicitud_id;
  select round(sum(t.total)*v_offer.exchange_rate,2) into v_chosen from (
    select tax.total from public.detalle_ofertas_compra d
    join public.solicitud_compra_lineas l on l.id=d.solicitud_linea_id
    cross join lateral app_private._calcular_impuestos_compra_v1(
      d.tratamiento_tributario,ceil(l.cantidad)*round(d.precio_unitario,2),d.tasa_tributaria) tax
    where d.oferta_id=p_oferta_id and l.solicitud_id=p_solicitud_id
  ) t;
  if (select count(*) from public.detalle_ofertas_compra d join public.solicitud_compra_lineas l on l.id=d.solicitud_linea_id
      where d.oferta_id=p_oferta_id and l.solicitud_id=p_solicitud_id)<>v_line_count or coalesce(v_chosen,0)<=0 then
    raise exception 'La oferta estÃ¡ incompleta o su total es cero; no puede ganar por defecto.' using errcode='23514';
  end if;
  select min(t.total_pen) into v_lowest from (
    select o.id,round(sum(x.total)*o.exchange_rate,2) as total_pen
    from public.ofertas_compra o
    join public.detalle_ofertas_compra d on d.oferta_id=o.id
    join public.solicitud_compra_lineas l on l.id=d.solicitud_linea_id and l.solicitud_id=p_solicitud_id
    cross join lateral app_private._calcular_impuestos_compra_v1(
      d.tratamiento_tributario,ceil(l.cantidad)*round(d.precio_unitario,2),d.tasa_tributaria) x
    where o.solicitud_id=p_solicitud_id and o.estado='Vigente' and o.es_version_actual
      and (o.vigencia_hasta is null or o.vigencia_hasta>=current_date)
      and d.tratamiento_tributario in ('Gravado','Exonerado','Inafecto') and d.tasa_tributaria in (0,18)
    group by o.id,o.exchange_rate
    having count(*)=v_line_count and round(sum(x.total)*o.exchange_rate,2)>0
  ) t;
  if v_chosen>v_lowest and length(trim(p_motivo))<12 then
    raise exception 'No es la oferta de menor total con impuestos en PEN; justifica con al menos 12 caracteres.' using errcode='22023';
  end if;
  update public.ofertas_compra set estado='Seleccionada',seleccionado_por=v_uid,seleccionado_en=clock_timestamp(),updated_at=clock_timestamp() where id=p_oferta_id;
  update public.solicitudes_compra set seleccion_oferta_id=p_oferta_id,estado='Cerrada',seleccion_motivo=trim(p_motivo),
    seleccionado_por=v_uid,seleccionado_en=clock_timestamp(),updated_by=v_uid,updated_at=clock_timestamp() where id=p_solicitud_id;
  insert into app_private.purchase_transition_idempotency(idempotency_key,operation,payload_hash,result_id,result_version)
    values(p_idempotency_key,'seleccionar_oferta_con_motivo',v_hash,p_solicitud_id,v_request.version);
  return p_solicitud_id;
end
$function$;
revoke all on function public.seleccionar_oferta_compra_v4(uuid, uuid, text, text) from public, anon;
grant execute on function public.seleccionar_oferta_compra_v4(uuid, uuid, text, text) to authenticated;