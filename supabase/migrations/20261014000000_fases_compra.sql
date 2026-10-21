-- =============================================================================
-- ERP EnterpriseCloud · Órdenes de compra por fases
-- La orden avanza: Solicitud → Orden → Recepción → Factura → Pagada.
-- El stock ingresa a almacén (+ kardex) SOLO al llegar a Recepción, donde se
-- registra el comprobante del proveedor. La CxP se completa al pagar.
-- Además guarda fecha límite y comprobante (tipo + número) de la recepción.
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- =============================================================================

-- 1. Nuevos estados de fase (superset: no afecta ningún dato ya guardado).
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
    'Solicitud','Orden','Recepción','Factura','Pagada'));
end $$;

-- 2. Columnas de seguimiento en compras.
alter table public.compras add column if not exists fecha_limite date;
alter table public.compras add column if not exists comprobante_tipo text;
alter table public.compras add column if not exists comprobante_numero text;
comment on column public.compras.fecha_limite is 'Fecha límite o aproximada para concretar la compra.';
comment on column public.compras.comprobante_tipo is 'Comprobante entregado en la recepción: Factura, Boleta, Guía de Remisión o Nota de Venta.';
comment on column public.compras.comprobante_numero is 'Número del comprobante de recepción.';

-- 3. Mapeo de estados viejos a fases (solo toca los 4 valores anteriores).
update public.compras set estado = 'Solicitud' where estado = 'Pendiente';
update public.compras set estado = 'Orden'      where estado = 'En curso';
update public.compras set estado = 'Recepción'  where estado = 'En tránsito';
update public.compras set estado = 'Factura'    where estado = 'Completada';
