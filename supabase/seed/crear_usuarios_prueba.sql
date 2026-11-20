-- Paso previo: en Supabase → Authentication → Users → "Add user" crea 2 usuarios
-- (marca "Auto Confirm User") con estos correos o los tuyos, y cámbialos aquí.
-- Luego ejecuta este script: los vincula a la tabla usuarios con su rol.
insert into public.usuarios (id, nombre, email, rol_id, activo)
select au.id, 'Solicitante Prueba', au.email, (select id from public.roles where nombre = 'Operador'), true
from auth.users au where au.email = 'solicitante@prueba.pe'
on conflict (id) do update set rol_id = excluded.rol_id, activo = true;

insert into public.usuarios (id, nombre, email, rol_id, activo)
select au.id, 'Gerente Prueba', au.email, (select id from public.roles where nombre = 'Gerente'), true
from auth.users au where au.email = 'gerente@prueba.pe'
on conflict (id) do update set rol_id = excluded.rol_id, activo = true;

select u.email, r.nombre as rol, u.activo from public.usuarios u join public.roles r on r.id = u.rol_id;
