-- Corrige la ruta histórica de ajuste para que el trigger trg_kardex no
-- duplique el movimiento explícito que registra este helper.
-- Preserva firma, retorno, wrapper público, ACL y demás reglas observadas.
-- Aplicar solo después de validar el preflight y conservar el resultado.

begin;

do $preflight$
declare
  v_function oid := to_regprocedure(
    'app_private._registrar_ajuste_inventario(uuid,uuid,integer,text,text)'
  );
begin
  if v_function is null then
    raise exception 'No existe app_private._registrar_ajuste_inventario con la firma esperada; no se aplicó el cambio.';
  end if;

  if pg_get_function_result(v_function) <> 'void' then
    raise exception 'El retorno del helper cambió; revisar manualmente antes de aplicar.';
  end if;

  if not (select p.prosecdef from pg_proc p where p.oid = v_function) then
    raise exception 'El helper ya no es SECURITY DEFINER; revisar manualmente antes de aplicar.';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = to_regclass('public.productos')
      and t.tgfoid = to_regprocedure('public.registrar_kardex()')
      and t.tgname = 'trg_kardex'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ) then
    raise exception 'No se encontró activo trg_kardex en public.productos; revisar el estado remoto antes de aplicar.';
  end if;
end
$preflight$;

create or replace function app_private._registrar_ajuste_inventario(
  p_producto_id uuid,
  p_almacen_id uuid,
  p_cantidad integer,
  p_motivo text,
  p_idempotency_key text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_motivo text := nullif(btrim(p_motivo), '');
  v_antes integer;
  v_nuevo integer;
  v_global integer;
  v_hash text;
  v_existing_hash text;
begin
  if v_uid is null or not (select public.tiene_permiso('inventario','editar')) then
    raise exception 'No tienes permiso para ajustar inventario.' using errcode = '42501';
  end if;

  if p_producto_id is null or p_almacen_id is null or p_cantidad is null or p_cantidad = 0
     or v_motivo is null or v_key is null then
    raise exception 'Indica producto, almacén, cantidad distinta de cero, motivo y clave de solicitud.' using errcode = '22023';
  end if;

  v_hash := md5(concat_ws('|',p_producto_id,p_almacen_id,p_cantidad,v_motivo));
  perform pg_advisory_xact_lock(hashtextextended(v_key,0));

  select payload_hash into v_existing_hash
  from public.movimientos_inventario
  where idempotency_key = v_key;

  if found then
    if v_existing_hash is not distinct from v_hash then
      return;
    end if;
    raise exception 'La clave ya se utilizó para otro ajuste.' using errcode = '23505';
  end if;

  select cantidad into v_antes
  from public.inventarios
  where producto_id = p_producto_id and almacen_id = p_almacen_id
  for update;

  if not found then
    raise exception 'El producto no tiene apertura de stock en ese almacén.' using errcode = '23503';
  end if;

  v_nuevo := v_antes + p_cantidad;
  if v_nuevo < 0 then
    raise exception 'El ajuste dejaría el stock del almacén en negativo.' using errcode = '23514';
  end if;

  select stock into v_global
  from public.productos
  where id = p_producto_id
  for update;

  if not found or v_global + p_cantidad < 0 then
    raise exception 'El ajuste no puede dejar el stock global en negativo.' using errcode = '23514';
  end if;

  update public.inventarios
  set cantidad = v_nuevo, updated_at = now()
  where producto_id = p_producto_id and almacen_id = p_almacen_id;

  -- Este helper ya registra el movimiento explícitamente más abajo. La bandera
  -- evita que trg_kardex cree un segundo movimiento al cambiar productos.stock.
  perform set_config('app.ec_inventory_rpc', 'on', true);

  update public.productos
  set stock = v_global + p_cantidad, updated_at = now()
  where id = p_producto_id;

  insert into public.movimientos_inventario
    (producto_id, almacen_id, tipo, cantidad, stock_anterior, stock_nuevo,
     referencia, usuario_id, idempotency_key, payload_hash)
  values
    (p_producto_id, p_almacen_id, 'ajuste', p_cantidad, v_antes, v_nuevo,
     v_motivo, v_uid, v_key, v_hash);
end
$function$;

-- CREATE OR REPLACE conserva las ACL de la función existente. Verificar que
-- authenticated conserve EXECUTE; no se conceden permisos nuevos aquí.
do $postflight$
declare
  v_function oid := to_regprocedure(
    'app_private._registrar_ajuste_inventario(uuid,uuid,integer,text,text)'
  );
begin
  if v_function is null
     or not has_function_privilege('authenticated', v_function, 'EXECUTE')
     or not (select p.prosecdef from pg_proc p where p.oid = v_function)
     or position('app.ec_inventory_rpc' in pg_get_functiondef(v_function)) = 0 then
    raise exception 'La validación posterior del helper falló; se revierte la migración.';
  end if;
end
$postflight$;

commit;
