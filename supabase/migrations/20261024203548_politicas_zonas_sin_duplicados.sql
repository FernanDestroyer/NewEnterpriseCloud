-- Evita políticas SELECT duplicadas en las tablas de asignación de zonas.
begin;
drop policy if exists zonas_sucursales_read on public.zonas_sucursales;
drop policy if exists zonas_sucursales_write on public.zonas_sucursales;
create policy zonas_sucursales_select on public.zonas_sucursales for select to authenticated using ((select public.tiene_permiso('configuracion','ver')) or (select public.tiene_permiso('configuracion','editar')));
create policy zonas_sucursales_insert on public.zonas_sucursales for insert to authenticated with check ((select public.tiene_permiso('configuracion','editar')));
create policy zonas_sucursales_update on public.zonas_sucursales for update to authenticated using ((select public.tiene_permiso('configuracion','editar'))) with check ((select public.tiene_permiso('configuracion','editar')));
create policy zonas_sucursales_delete on public.zonas_sucursales for delete to authenticated using ((select public.tiene_permiso('configuracion','editar')));
drop policy if exists zonas_clientes_read on public.zonas_clientes;
drop policy if exists zonas_clientes_write on public.zonas_clientes;
create policy zonas_clientes_select on public.zonas_clientes for select to authenticated using ((select public.tiene_permiso('configuracion','ver')) or (select public.tiene_permiso('configuracion','editar')));
create policy zonas_clientes_insert on public.zonas_clientes for insert to authenticated with check ((select public.tiene_permiso('configuracion','editar')));
create policy zonas_clientes_update on public.zonas_clientes for update to authenticated using ((select public.tiene_permiso('configuracion','editar'))) with check ((select public.tiene_permiso('configuracion','editar')));
create policy zonas_clientes_delete on public.zonas_clientes for delete to authenticated using ((select public.tiene_permiso('configuracion','editar')));
commit;