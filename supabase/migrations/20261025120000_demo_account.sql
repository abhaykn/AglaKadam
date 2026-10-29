-- The account of a role in a demonstration district is read past the private tables' privileges,
-- as every other demonstration service function reads them, so that a visitor can switch roles.

create or replace function private.demo_account_of(target_sandbox uuid, role text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.email from private.demo_accounts as a
  where a.sandbox_id = target_sandbox and a.role = demo_account_of.role
$$;
