#!/usr/bin/env bash
# Prueba LOCAL de reglas de aprobación, auto-aprobación bajo umbral y alertas predictivas.
# Usa un PostgreSQL desechable con un esquema mínimo que imita Supabase (stubs) + el SQL real
# de las migraciones. NO toca ningún proyecto de Supabase y NO reemplaza la prueba con usuarios reales.
# Uso: PGHOST=... PGPORT=... PGUSER=postgres ./run.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; M="$HERE/../../migrations"
DB="${DB:-ec_aprobaciones_test}"
dropdb --if-exists "$DB"; createdb "$DB"
P="psql -v ON_ERROR_STOP=1 -q -d $DB"
for f in "$HERE/00_stubs.sql" "$HERE/10_approvals_tables.sql" "$HERE/11_event_fn.sql" "$HERE/12_decide_fn.sql" \
         "$M/20261113043804_persistent_operational_notifications.sql" "$M/20261113120316_approval_notifications_inbox_v1.sql" \
         "$M/20261120000000_reglas_aprobacion_umbrales_v1.sql" "$M/20261120000100_alertas_predictivas_v1.sql"; do $P -f "$f"; done
$P -c "grant usage on schema public, auth, app_private to authenticated; grant select on all tables in schema public to authenticated; grant update on public.notificaciones to authenticated; grant execute on all functions in schema public to authenticated;"
psql -q -t -A -d "$DB" -f "$HERE/20_scenarios.sql" | grep -E "^==|TODAS"
