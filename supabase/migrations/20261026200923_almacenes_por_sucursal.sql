-- En V1 todo almacén pertenece a una sucursal y su nombre solo debe ser único dentro de ella.
-- La consulta previa confirmó que no existen almacenes sin sucursal ni datos que migrar.
begin;

alter table public.almacenes
  drop constraint if exists almacenes_nombre_key;

alter table public.almacenes
  alter column sucursal_id set not null;

create unique index if not exists almacenes_sucursal_nombre_uidx
  on public.almacenes (sucursal_id, lower(btrim(nombre)));

commit;
