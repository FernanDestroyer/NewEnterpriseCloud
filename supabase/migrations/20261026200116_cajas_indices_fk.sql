begin;

create index cajas_created_by_idx
  on public.cajas (created_by);
create index cajas_responsable_id_idx
  on public.cajas (responsable_id);

commit;
