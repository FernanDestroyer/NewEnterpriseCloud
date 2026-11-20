// Dependencia opcional de QA: indicar la ruta del entrypoint ESM de PGlite.
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const pglite = process.argv[2]
if (!pglite) throw new Error('Uso: node supabase/tests/comunidad/run.mjs RUTA_A_PGLITE/dist/index.js')
const { PGlite } = await import(pathToFileURL(resolve(pglite)).href)
const fixture = await readFile(new URL('00_fixture.sql', import.meta.url), 'utf8')
const migration = await readFile(new URL('../../migrations/20261120000300_comunidad_grupos.sql', import.meta.url), 'utf8')
const adminMigration = await readFile(new URL('../../migrations/20261120000400_comunidad_acceso_administrador.sql', import.meta.url), 'utf8')
const membersMigration = await readFile(new URL('../../migrations/20261120000500_comunidad_grupos_miembros.sql', import.meta.url), 'utf8')
const db = new PGlite()
try {
  await db.exec(fixture)
  await db.exec(migration)
  await db.exec(adminMigration)
  await db.exec(membersMigration)
  await db.exec(await readFile(new URL('10_scenarios.sql', import.meta.url), 'utf8'))
  await db.exec(await readFile(new URL('20_members.sql', import.meta.url), 'utf8'))
  console.log('Comunidad: roles, RLS, gestión, idempotencia, archivo y auditoría verificados.')
} finally {
  await db.close()
}

const alternate = new PGlite()
try {
  await alternate.exec(fixture)
  await alternate.exec("insert into public.roles values ('00000000-0000-0000-0000-000000000006', 'Usuario')")
  await alternate.exec(migration)
  await alternate.exec(adminMigration)
  await alternate.exec(membersMigration)
  await alternate.exec(`
    do $$ begin
      if (select count(*) from public.comunidad_grupos where nombre = 'Usuarios' and rol_id = '00000000-0000-0000-0000-000000000006') <> 1
        then raise exception 'Usuarios debe usar el rol Usuario si existe'; end if;
    end $$;
    set role authenticated;
    select set_config('test.user_id', '10000000-0000-0000-0000-000000000001', false);
    do $$ begin
      if exists (select 1 from public.comunidad_listar_grupos()) then raise exception 'Básico no debe tener acceso si el rol Usuario existe'; end if;
    end $$;
  `)
  console.log('Comunidad: preferencia por el rol Usuario y exclusión de Básico verificadas.')
} finally {
  await alternate.close()
}
