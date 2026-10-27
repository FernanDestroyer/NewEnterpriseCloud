begin;

-- The company master has no delete RLS policy; remove the unused API grant too.
revoke delete on table public.empresas from authenticated;

commit;
