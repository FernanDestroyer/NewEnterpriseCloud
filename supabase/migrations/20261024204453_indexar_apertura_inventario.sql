-- Cobertura de la FK de autoría para conservar búsquedas y acciones referenciales rápidas.
begin;
create index if not exists aperturas_inventario_realizado_por_idx
  on public.aperturas_inventario(realizado_por) where realizado_por is not null;
commit;