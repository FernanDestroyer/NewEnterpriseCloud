-- Habilita importación de cabeceras comerciales para administradores.
insert into public.permisos (modulo, accion)
values ('ventas', 'importar'), ('compras', 'importar')
on conflict (modulo, accion) do nothing;

insert into public.rol_permisos (rol_id, permiso_id)
select r.id, p.id
from public.roles r
join public.permisos p on p.accion = 'importar' and p.modulo in ('ventas', 'compras')
where r.nombre = 'Administrador'
on conflict do nothing;

-- La acción importar permite insertar registros por los mismos servicios que usa el formulario.
drop policy if exists ventas_insert on public.ventas;
create policy ventas_insert on public.ventas for insert to authenticated
  with check (
    (select public.tiene_permiso('ventas', 'crear'))
    or (select public.tiene_permiso('ventas', 'importar'))
  );

drop policy if exists compras_insert on public.compras;
create policy compras_insert on public.compras for insert to authenticated
  with check (
    (select public.tiene_permiso('compras', 'crear'))
    or (select public.tiene_permiso('compras', 'importar'))
  );

-- Permite que las importaciones creen únicamente su cuenta por cobrar/pagar asociada;
-- el usuario debe ser autor del documento y los datos deben coincidir con su cabecera.
drop policy if exists pagos_insert on public.pagos;
create policy pagos_insert on public.pagos for insert to authenticated
  with check (
    (select public.tiene_permiso('finanzas', 'crear'))
    or (
      tipo = 'cobrar' and venta_id is not null and compra_id is null
      and (select public.tiene_permiso('ventas', 'importar'))
      and exists (
        select 1 from public.ventas v
        where v.id = pagos.venta_id and v.created_by = (select auth.uid())
          and pagos.contraparte = v.cliente_nombre
          and pagos.detalle = 'Cuenta por cobrar · ' || v.codigo
          and pagos.monto = v.monto
      )
    )
    or (
      tipo = 'pagar' and compra_id is not null and venta_id is null
      and (select public.tiene_permiso('compras', 'importar'))
      and exists (
        select 1 from public.compras c
        where c.id = pagos.compra_id and c.created_by = (select auth.uid())
          and pagos.contraparte = c.proveedor_nombre
          and pagos.detalle = 'Cuenta por pagar · ' || c.codigo
          and pagos.monto = round(c.monto * 1.18, 2)
      )
    )
  );
