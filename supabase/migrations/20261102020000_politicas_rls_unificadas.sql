-- Agrupa políticas equivalentes sin ampliar sus permisos efectivos.
begin;
drop policy if exists clientes_import_insert on public.clientes;
drop policy if exists clientes_insert on public.clientes;
create policy clientes_insert on public.clientes for insert to authenticated
  with check ((select app_private._tiene_permiso('clientes', 'crear')) or (select app_private._tiene_permiso('clientes', 'importar')));

drop policy if exists configuracion_select on public.configuracion;
drop policy if exists configuracion_yape_select on public.configuracion;
create policy configuracion_select on public.configuracion for select to authenticated
  using ((select app_private._tiene_permiso('configuracion', 'ver')) or
    (codigo = 'YAPE_QR' and ((select app_private._tiene_permiso('ventas', 'ver')) or (select app_private._tiene_permiso('finanzas', 'ver')))));

drop policy if exists permisos_admin on public.permisos;
drop policy if exists permisos_select on public.permisos;
drop policy if exists permisos_admin_insert on public.permisos;
drop policy if exists permisos_admin_update on public.permisos;
drop policy if exists permisos_admin_delete on public.permisos;
create policy permisos_select on public.permisos for select to authenticated using ((select app_private._usuario_activo()));
create policy permisos_admin_insert on public.permisos for insert to authenticated with check ((select app_private._es_admin()));
create policy permisos_admin_update on public.permisos for update to authenticated
  using ((select app_private._es_admin())) with check ((select app_private._es_admin()));
create policy permisos_admin_delete on public.permisos for delete to authenticated using ((select app_private._es_admin()));

drop policy if exists proveedor_productos_import_insert on public.proveedor_productos;
drop policy if exists proveedor_productos_insert on public.proveedor_productos;
create policy proveedor_productos_insert on public.proveedor_productos for insert to authenticated
  with check ((select app_private._tiene_permiso('compras', 'crear')) or (select app_private._tiene_permiso('proveedores', 'importar')));
drop policy if exists proveedor_productos_import_select on public.proveedor_productos;
drop policy if exists proveedor_productos_select on public.proveedor_productos;
create policy proveedor_productos_select on public.proveedor_productos for select to authenticated
  using ((select app_private._tiene_permiso('compras', 'ver')) or (select app_private._tiene_permiso('proveedores', 'importar')));

drop policy if exists proveedores_import_insert on public.proveedores;
drop policy if exists proveedores_insert on public.proveedores;
create policy proveedores_insert on public.proveedores for insert to authenticated
  with check ((select app_private._tiene_permiso('proveedores', 'crear')) or (select app_private._tiene_permiso('proveedores', 'importar')));

drop policy if exists rol_permisos_admin on public.rol_permisos;
drop policy if exists rol_permisos_select on public.rol_permisos;
drop policy if exists rol_permisos_admin_insert on public.rol_permisos;
drop policy if exists rol_permisos_admin_update on public.rol_permisos;
drop policy if exists rol_permisos_admin_delete on public.rol_permisos;
create policy rol_permisos_select on public.rol_permisos for select to authenticated using ((select app_private._usuario_activo()));
create policy rol_permisos_admin_insert on public.rol_permisos for insert to authenticated with check ((select app_private._es_admin()));
create policy rol_permisos_admin_update on public.rol_permisos for update to authenticated
  using ((select app_private._es_admin())) with check ((select app_private._es_admin()));
create policy rol_permisos_admin_delete on public.rol_permisos for delete to authenticated using ((select app_private._es_admin()));

drop policy if exists roles_admin on public.roles;
drop policy if exists roles_select on public.roles;
drop policy if exists roles_admin_insert on public.roles;
drop policy if exists roles_admin_update on public.roles;
drop policy if exists roles_admin_delete on public.roles;
create policy roles_select on public.roles for select to authenticated using ((select app_private._usuario_activo()));
create policy roles_admin_insert on public.roles for insert to authenticated with check ((select app_private._es_admin()));
create policy roles_admin_update on public.roles for update to authenticated
  using ((select app_private._es_admin())) with check ((select app_private._es_admin()));
create policy roles_admin_delete on public.roles for delete to authenticated using ((select app_private._es_admin()));

drop policy if exists usuario_permisos_admin on public.usuario_permisos;
drop policy if exists usuario_permisos_select on public.usuario_permisos;
drop policy if exists usuario_permisos_admin_insert on public.usuario_permisos;
drop policy if exists usuario_permisos_admin_update on public.usuario_permisos;
drop policy if exists usuario_permisos_admin_delete on public.usuario_permisos;
create policy usuario_permisos_select on public.usuario_permisos for select to authenticated
  using (usuario_id = (select auth.uid()) or (select app_private._es_admin()));
create policy usuario_permisos_admin_insert on public.usuario_permisos for insert to authenticated with check ((select app_private._es_admin()));
create policy usuario_permisos_admin_update on public.usuario_permisos for update to authenticated
  using ((select app_private._es_admin())) with check ((select app_private._es_admin()));
create policy usuario_permisos_admin_delete on public.usuario_permisos for delete to authenticated using ((select app_private._es_admin()));
commit;
