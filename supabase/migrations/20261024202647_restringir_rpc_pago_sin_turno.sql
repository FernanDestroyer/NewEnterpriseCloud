-- Evita que el RPC legado registre efectivo sin asociarlo a un turno abierto.
-- El wrapper registrar_pago_parcial_en_turno lo invoca como propietario.
revoke all on function public.registrar_pago_parcial(text,numeric,text,text,jsonb,text,text) from public,anon,authenticated;
