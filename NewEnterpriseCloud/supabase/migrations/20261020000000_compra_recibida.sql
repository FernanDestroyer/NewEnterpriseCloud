-- =============================================================================
-- ERP EnterpriseCloud · Estado Recibida en órdenes de compra
-- Flujo en dos pasos (como la referencia): Recibir marca la orden como
-- Recibida SIN mover stock; Registrar ingreso (Ingreso al Kardex) la pasa a
-- Recepción y aplica lo comprado al inventario (+ kardex).
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

-- 1. Nuevo estado (superset: no afecta ningún dato ya guardado).
do $$
declare v_constraint name;
begin
  select conname into v_constraint
    from pg_constraint
   where contypid = 'public.estado_registro'::regtype and contype = 'c'
   limit 1;
  if v_constraint is not null then
    execute format('alter domain public.estado_registro drop constraint %I', v_constraint);
  end if;
  alter domain public.estado_registro add check (value in (
    'Activo','Bajo stock','Completada','Crítico','En curso','En tránsito',
    'Estable','Pendiente','Vigente','Aprobada','Rechazada','Vencida',
    'Solicitud','Orden','Recibida','Recepción','Factura','Pagada'));
end $$;
