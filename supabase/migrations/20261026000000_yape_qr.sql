-- QR de Yape: se guarda en configuracion (codigo YAPE_QR).
-- Los usuarios de ventas/finanzas pueden leer exclusivamente esa configuración.
-- La escritura conserva los permisos de configuración existentes.

drop policy if exists configuracion_yape_select on public.configuracion;
create policy configuracion_yape_select on public.configuracion
  for select to authenticated
  using (
    codigo = 'YAPE_QR'
    and (
      (select public.tiene_permiso('ventas', 'ver'))
      or (select public.tiene_permiso('finanzas', 'ver'))
    )
  );
