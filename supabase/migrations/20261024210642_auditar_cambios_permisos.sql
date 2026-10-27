-- La tabla de permisos también debe generar trazabilidad ante cambios de acceso.
create trigger trg_auditoria
after insert or update or delete on public.permisos
for each row execute function public.fn_auditar();
