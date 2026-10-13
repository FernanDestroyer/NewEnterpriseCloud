-- =============================================================================
-- ERP EnterpriseCloud · Catálogo de productos por proveedor
-- Modelo correcto: el catálogo del proveedor vive solo (lo que ofrece). La
-- compra lo trae y, SOLO al completarse, ingresa a MI inventario (crea el
-- producto si es nuevo o suma stock si ya existe). El inventario ya no se
-- vincula al proveedor.
--
-- Cómo ejecutarlo: Supabase Dashboard -> SQL Editor -> New query -> pegar -> Run.
-- Es idempotente: se puede volver a ejecutar sin duplicar ni borrar nada.
-- Requiere haber ejecutado antes las migraciones de productos (proveedor_id y
-- precio) para rescatar los vínculos ya cargados; si no existen, se omite el
-- rescate y todo lo demás se crea igual.
-- =============================================================================

-- 1. Secuencia para los códigos del catálogo (PP-0001, PP-0002, ...).
create sequence if not exists public.seq_catalogo as bigint;

-- 2. Catálogo: lo que ofrece cada proveedor, independiente de mi inventario.
--    producto_id apunta a MI producto equivalente una vez que ingresó (null =
--    aún no lo tengo en inventario; se vincula solo al completar la compra).
create table if not exists public.proveedor_productos (
  id           uuid primary key default gen_random_uuid(),
  codigo       text not null unique,
  proveedor_id uuid not null references public.proveedores(id) on delete cascade,
  nombre       text not null,
  detalle      text not null default '',
  costo        numeric(14,2) not null default 0 check (costo >= 0),
  producto_id  uuid references public.productos(id) on delete set null,
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (proveedor_id, nombre)
);
create index if not exists proveedor_productos_proveedor_idx on public.proveedor_productos (proveedor_id);

-- 3. Triggers de utilidad (misma convención que el resto de módulos).
drop trigger if exists trg_updated_at on public.proveedor_productos;
create trigger trg_updated_at before update on public.proveedor_productos
  for each row execute function public.set_updated_at();

drop trigger if exists trg_codigo on public.proveedor_productos;
create trigger trg_codigo before insert on public.proveedor_productos
  for each row execute function public.asignar_codigo('PP', 'public.seq_catalogo', 4);

drop trigger if exists trg_auditoria on public.proveedor_productos;
create trigger trg_auditoria after insert or update or delete on public.proveedor_productos
  for each row execute function public.fn_auditar();

-- 4. Rescate (solo si existen las columnas viejas): convierte los vínculos
--    producto→proveedor y las líneas de compras de prueba en catálogo.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'productos' and column_name = 'proveedor_id') then
    -- 4a. Cada producto vinculado pasa a ser oferta de su proveedor.
    insert into public.proveedor_productos (proveedor_id, nombre, detalle, costo, producto_id)
    select p.proveedor_id, p.nombre, p.detalle, coalesce(p.precio, 0), p.id
      from public.productos p
     where p.proveedor_id is not null
    on conflict (proveedor_id, nombre) do nothing;

    -- 4b. Líneas de compras de prueba que referencian mi inventario.
    insert into public.proveedor_productos (proveedor_id, nombre, detalle, costo, producto_id)
    select distinct c.proveedor_id, p.nombre, p.detalle, d.costo_unitario, p.id
      from public.detalle_compras d
      join public.compras c   on c.id = d.compra_id
      join public.productos p on p.id = d.producto_id
     where c.proveedor_id is not null and d.producto_id is not null
    on conflict (proveedor_id, nombre) do nothing;

    -- 4c. Re-apunta esas líneas al catálogo recién creado.
    update public.detalle_compras d set producto_id = pp.id
      from public.compras c, public.productos p, public.proveedor_productos pp
     where d.compra_id = c.id and d.producto_id = p.id
       and pp.proveedor_id = c.proveedor_id and pp.nombre = p.nombre;
  end if;
end $$;

-- 5. Huérfanas a null (incluye pruebas viejas sin proveedor atribuible).
update public.detalle_compras set producto_id = null
 where producto_id is not null
   and not exists (select 1 from public.proveedor_productos pp where pp.id = detalle_compras.producto_id);

-- 6. La línea de compra ahora referencia al CATÁLOGO, no a mi inventario.
alter table public.detalle_compras rename column producto_id to proveedor_producto_id;

do $$
declare v_constraint name;
begin
  -- Suelta la FK vieja hacia productos (si existe).
  select conname into v_constraint
    from pg_constraint
   where conrelid = 'public.detalle_compras'::regclass
     and confrelid = 'public.productos'::regclass
   limit 1;
  if v_constraint is not null then
    execute format('alter table public.detalle_compras drop constraint %I', v_constraint);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'detalle_compras_catalogo_fkey') then
    alter table public.detalle_compras add constraint detalle_compras_catalogo_fkey
      foreign key (proveedor_producto_id) references public.proveedor_productos(id) on delete set null;
  end if;
end $$;

-- 7. El inventario deja de depender del proveedor.
drop index if exists public.productos_proveedor_idx;
alter table public.productos drop column if exists proveedor_id;

-- 8. Seguridad: el catálogo se gobierna con los permisos de COMPRAS
--    (quien compra gestiona el catálogo; el detalle hereda el mismo módulo).
alter table public.proveedor_productos enable row level security;

drop policy if exists proveedor_productos_select on public.proveedor_productos;
create policy proveedor_productos_select on public.proveedor_productos for select to authenticated
  using ((select public.tiene_permiso('compras', 'ver')));
drop policy if exists proveedor_productos_insert on public.proveedor_productos;
create policy proveedor_productos_insert on public.proveedor_productos for insert to authenticated
  with check ((select public.tiene_permiso('compras', 'crear')));
drop policy if exists proveedor_productos_update on public.proveedor_productos;
create policy proveedor_productos_update on public.proveedor_productos for update to authenticated
  using ((select public.tiene_permiso('compras', 'editar')))
  with check ((select public.tiene_permiso('compras', 'editar')));
drop policy if exists proveedor_productos_delete on public.proveedor_productos;
create policy proveedor_productos_delete on public.proveedor_productos for delete to authenticated
  using ((select public.tiene_permiso('compras', 'eliminar')));

-- El rol anónimo (visitante sin sesión) no toca esta tabla.
revoke all on public.proveedor_productos from anon;
revoke all on sequence public.seq_catalogo from anon;
