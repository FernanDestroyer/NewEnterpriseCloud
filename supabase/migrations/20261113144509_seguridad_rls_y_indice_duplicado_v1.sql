begin;
set local lock_timeout = '5s';

-- Conserva la unicidad por codigo (constraint/index contratos_compra_codigo_key)
-- y elimina solo el segundo índice btree idéntico, que no tiene dependencia.
drop index if exists public.contratos_compra_codigo_unico_idx;

-- Unificar políticas SELECT solapadas como la misma disyunción de permisos.
alter policy clientes_select on public.clientes
  using (
    (select public.tiene_permiso('clientes','ver'))
    or (select public.tiene_permiso('ventas','ver'))
    or (select public.tiene_permiso('cotizaciones','ver'))
  );
drop policy if exists ec_sales_customers_read on public.clientes;

alter policy productos_select on public.productos
  using (
    (select public.tiene_permiso('inventario','ver'))
    or (select public.tiene_permiso('ventas','ver'))
    or (select public.tiene_permiso('cotizaciones','ver'))
  );
drop policy if exists ec_sales_products_read on public.productos;

-- Las políticas ALL anteriores también daban SELECT con permiso editar.
-- Se conserva ese acceso como OR en la política read y se separan escrituras
-- por acción sin ampliar los permisos efectivos.
alter policy escalas_comision_read on public.escalas_comision
  using (
    (select public.tiene_permiso('ventas','ver'))
    or (select public.tiene_permiso('ventas','editar'))
  );
drop policy if exists escalas_comision_write on public.escalas_comision;
create policy escalas_comision_insert on public.escalas_comision
  for insert to authenticated
  with check ((select public.tiene_permiso('ventas','editar')));
create policy escalas_comision_update on public.escalas_comision
  for update to authenticated
  using ((select public.tiene_permiso('ventas','editar')))
  with check ((select public.tiene_permiso('ventas','editar')));
create policy escalas_comision_delete on public.escalas_comision
  for delete to authenticated
  using ((select public.tiene_permiso('ventas','editar')));

alter policy excepciones_comision_read on public.excepciones_comision
  using (
    (select public.tiene_permiso('ventas','ver'))
    or (select public.tiene_permiso('ventas','editar'))
  );
drop policy if exists excepciones_comision_write on public.excepciones_comision;
create policy excepciones_comision_insert on public.excepciones_comision
  for insert to authenticated
  with check ((select public.tiene_permiso('ventas','editar')));
create policy excepciones_comision_update on public.excepciones_comision
  for update to authenticated
  using ((select public.tiene_permiso('ventas','editar')))
  with check ((select public.tiene_permiso('ventas','editar')));
create policy excepciones_comision_delete on public.excepciones_comision
  for delete to authenticated
  using ((select public.tiene_permiso('ventas','editar')));

alter policy reglas_comision_read on public.reglas_comision
  using (
    (select public.tiene_permiso('ventas','ver'))
    or (select public.tiene_permiso('ventas','editar'))
  );
drop policy if exists reglas_comision_write on public.reglas_comision;
create policy reglas_comision_insert on public.reglas_comision
  for insert to authenticated
  with check ((select public.tiene_permiso('ventas','editar')));
create policy reglas_comision_update on public.reglas_comision
  for update to authenticated
  using ((select public.tiene_permiso('ventas','editar')))
  with check ((select public.tiene_permiso('ventas','editar')));
create policy reglas_comision_delete on public.reglas_comision
  for delete to authenticated
  using ((select public.tiene_permiso('ventas','editar')));

alter policy ventas_vendedor_read on public.ventas_vendedor
  using (
    (select public.tiene_permiso('ventas','ver'))
    or (select public.tiene_permiso('ventas','editar'))
  );
drop policy if exists ventas_vendedor_write on public.ventas_vendedor;
create policy ventas_vendedor_insert on public.ventas_vendedor
  for insert to authenticated
  with check ((select public.tiene_permiso('ventas','editar')));
create policy ventas_vendedor_update on public.ventas_vendedor
  for update to authenticated
  using ((select public.tiene_permiso('ventas','editar')))
  with check ((select public.tiene_permiso('ventas','editar')));
create policy ventas_vendedor_delete on public.ventas_vendedor
  for delete to authenticated
  using ((select public.tiene_permiso('ventas','editar')));

notify pgrst, 'reload schema';
commit;
