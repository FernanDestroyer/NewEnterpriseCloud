-- Mantiene los RPC públicos compatibles, pero mueve la ejecución privilegiada
-- fuera del esquema expuesto por PostgREST.
begin;

-- La reproducción cronológica no debe depender de que el esquema privado haya
-- sido creado manualmente o por una migración futura.
create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;

alter function public.anular_movimiento_tesoreria(uuid,text) set schema app_private;
alter function public.inicializar_stock_legacy_a_almacen(uuid) set schema app_private;
alter function public.obtener_saldos_cuentas(uuid[]) set schema app_private;
alter function public.registrar_movimiento_inventario(uuid,uuid,text,integer,text,text,text,uuid,text) set schema app_private;
alter function public.registrar_pago_parcial_en_turno(text,numeric,text,text,jsonb,text,text,uuid) set schema app_private;
alter function public.registrar_recepcion_compra(uuid,uuid,jsonb,text,text,text,text) set schema app_private;
alter function public.registrar_venta_operativa(uuid,text,text,text,numeric,numeric,text,uuid,jsonb,text,uuid,uuid) set schema app_private;

grant usage on schema app_private to authenticated;
revoke all on function app_private.anular_movimiento_tesoreria(uuid,text) from public,anon;
revoke all on function app_private.inicializar_stock_legacy_a_almacen(uuid) from public,anon;
revoke all on function app_private.obtener_saldos_cuentas(uuid[]) from public,anon;
revoke all on function app_private.registrar_movimiento_inventario(uuid,uuid,text,integer,text,text,text,uuid,text) from public,anon;
revoke all on function app_private.registrar_pago_parcial_en_turno(text,numeric,text,text,jsonb,text,text,uuid) from public,anon;
revoke all on function app_private.registrar_recepcion_compra(uuid,uuid,jsonb,text,text,text,text) from public,anon;
revoke all on function app_private.registrar_venta_operativa(uuid,text,text,text,numeric,numeric,text,uuid,jsonb,text,uuid,uuid) from public,anon;
grant execute on function app_private.anular_movimiento_tesoreria(uuid,text) to authenticated;
grant execute on function app_private.inicializar_stock_legacy_a_almacen(uuid) to authenticated;
grant execute on function app_private.obtener_saldos_cuentas(uuid[]) to authenticated;
grant execute on function app_private.registrar_movimiento_inventario(uuid,uuid,text,integer,text,text,text,uuid,text) to authenticated;
grant execute on function app_private.registrar_pago_parcial_en_turno(text,numeric,text,text,jsonb,text,text,uuid) to authenticated;
grant execute on function app_private.registrar_recepcion_compra(uuid,uuid,jsonb,text,text,text,text) to authenticated;
grant execute on function app_private.registrar_venta_operativa(uuid,text,text,text,numeric,numeric,text,uuid,jsonb,text,uuid,uuid) to authenticated;

create function public.anular_movimiento_tesoreria(p_movimiento_id uuid,p_motivo text)
returns void language sql security invoker set search_path = '' as $$
  select app_private.anular_movimiento_tesoreria($1,$2)
$$;
create function public.inicializar_stock_legacy_a_almacen(p_almacen_id uuid)
returns integer language sql security invoker set search_path = '' as $$
  select app_private.inicializar_stock_legacy_a_almacen($1)
$$;
create function public.obtener_saldos_cuentas(p_cuenta_ids uuid[])
returns table(cuenta_id uuid,monto_original numeric,monto_aplicado numeric,saldo_pendiente numeric)
language sql stable security invoker set search_path = '' as $$
  select * from app_private.obtener_saldos_cuentas($1)
$$;
create function public.registrar_movimiento_inventario(
  p_producto_id uuid,p_almacen_id uuid,p_tipo text,p_cantidad integer,p_referencia text,
  p_idempotency_key text,p_origen_tipo text default null,p_origen_id uuid default null,p_motivo text default null
)
returns uuid language sql security invoker set search_path = '' as $$
  select app_private.registrar_movimiento_inventario($1,$2,$3,$4,$5,$6,$7,$8,$9)
$$;
create function public.registrar_pago_parcial_en_turno(
  p_tipo text,p_monto numeric,p_medio_pago text,p_referencia text,p_aplicaciones jsonb,
  p_idempotency_key text,p_nota text default null,p_caja_turno_id uuid default null
)
returns uuid language sql security invoker set search_path = '' as $$
  select app_private.registrar_pago_parcial_en_turno($1,$2,$3,$4,$5,$6,$7,$8)
$$;
create function public.registrar_recepcion_compra(
  p_compra_id uuid,p_almacen_id uuid,p_lineas jsonb,p_idempotency_key text,
  p_comprobante_tipo text default null,p_comprobante_numero text default null,p_referencia text default null
)
returns uuid language sql security invoker set search_path = '' as $$
  select app_private.registrar_recepcion_compra($1,$2,$3,$4,$5,$6,$7)
$$;
create function public.registrar_venta_operativa(
  p_cliente_id uuid,p_cliente_nombre text,p_detalle text,p_estado text,p_monto_manual numeric,
  p_descuento numeric,p_medio_pago text,p_almacen_id uuid,p_lineas jsonb,p_idempotency_key text,
  p_caja_turno_id uuid default null,p_cotizacion_id uuid default null
)
returns uuid language sql security invoker set search_path = '' as $$
  select app_private.registrar_venta_operativa($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
$$;

revoke all on function public.anular_movimiento_tesoreria(uuid,text) from public,anon;
revoke all on function public.inicializar_stock_legacy_a_almacen(uuid) from public,anon;
revoke all on function public.obtener_saldos_cuentas(uuid[]) from public,anon;
revoke all on function public.registrar_movimiento_inventario(uuid,uuid,text,integer,text,text,text,uuid,text) from public,anon;
revoke all on function public.registrar_pago_parcial_en_turno(text,numeric,text,text,jsonb,text,text,uuid) from public,anon;
revoke all on function public.registrar_recepcion_compra(uuid,uuid,jsonb,text,text,text,text) from public,anon;
revoke all on function public.registrar_venta_operativa(uuid,text,text,text,numeric,numeric,text,uuid,jsonb,text,uuid,uuid) from public,anon;
grant execute on function public.anular_movimiento_tesoreria(uuid,text) to authenticated;
grant execute on function public.inicializar_stock_legacy_a_almacen(uuid) to authenticated;
grant execute on function public.obtener_saldos_cuentas(uuid[]) to authenticated;
grant execute on function public.registrar_movimiento_inventario(uuid,uuid,text,integer,text,text,text,uuid,text) to authenticated;
grant execute on function public.registrar_pago_parcial_en_turno(text,numeric,text,text,jsonb,text,text,uuid) to authenticated;
grant execute on function public.registrar_recepcion_compra(uuid,uuid,jsonb,text,text,text,text) to authenticated;
grant execute on function public.registrar_venta_operativa(uuid,text,text,text,numeric,numeric,text,uuid,jsonb,text,uuid,uuid) to authenticated;

commit;
