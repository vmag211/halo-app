-- HALO baseline catalog audit
--
-- READ-ONLY. One statement that returns one row with one JSON column,
-- halo_baseline_audit. It reads only the system catalogs (table and column
-- definitions, row level security flags, policies, foreign keys, functions,
-- privileges, triggers, extensions, roles and the migration ledger). It returns
-- no rows from any HALO table, no passwords and no keys.
--
-- Run it by hand in the Supabase SQL editor of the HALO project, then follow
-- docs/backend/baseline.md to paste the result back and diff it against
-- supabase/baseline/reconstructed_baseline.sql. The test suite runs this same
-- file against the local PGlite database inside a read-only transaction.
--
-- Sections (each is one key of the result):
--   tables                       every public table: columns (type, default,
--                                nullability), RLS flags, constraints (primary
--                                key, unique, check, exclusion; NOT NULL is the
--                                column's nullable flag), indexes
--   policies                     every policy on a public table (pg_policies)
--   foreign_keys                 every foreign key on a public table, with its
--                                ON DELETE action
--   functions                    every public function (extension members
--                                excluded): security definer flag, proacl
--   table_grants                 effective table privileges for anon and
--                                authenticated (service_role for comparison),
--                                plus column-level grants to anon,
--                                authenticated and PUBLIC
--   function_grants              effective EXECUTE for anon and authenticated
--   triggers                     user triggers on public tables and auth.users
--   extensions                   installed extensions and their schemas
--   roles                        the API roles' flags (no passwords)
--   default_privileges           default grants for new objects in public
--   auth_users_columns           the columns of auth.users (no rows)
--   supabase_migrations_ledger   version and name of each recorded migration,
--                                or null when supabase_migrations does not exist

with
audit_tables as (
  select coalesce(json_agg(json_build_object(
    'table', t.relname,
    'rls_enabled', t.relrowsecurity,
    'rls_forced', t.relforcerowsecurity,
    'columns', coalesce((
      select json_agg(json_build_object(
        'name', a.attname,
        'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
        'nullable', not a.attnotnull,
        'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid)
      ) order by a.attnum)
      from pg_catalog.pg_attribute a
      left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
    ), '[]'::json),
    'constraints', coalesce((
      select json_agg(json_build_object(
        'name', con.conname,
        'type', case con.contype when 'p' then 'primary key' when 'u' then 'unique'
                  when 'c' then 'check' when 'x' then 'exclusion' else con.contype::text end,
        'definition', pg_catalog.pg_get_constraintdef(con.oid),
        'validated', con.convalidated
      ) order by con.conname)
      from pg_catalog.pg_constraint con
      -- Foreign keys have their own section. NOT NULL is reported per column
      -- (nullable); Postgres 18 also stores it as constraint rows (contype 'n')
      -- that older servers do not have, so they are left out to keep the two
      -- sides comparable.
      where con.conrelid = t.oid and con.contype not in ('f', 'n')
    ), '[]'::json),
    'indexes', coalesce((
      select json_agg(pg_catalog.pg_get_indexdef(i.indexrelid) order by ic.relname)
      from pg_catalog.pg_index i
      join pg_catalog.pg_class ic on ic.oid = i.indexrelid
      where i.indrelid = t.oid
    ), '[]'::json)
  ) order by t.relname), '[]'::json) as value
  from pg_catalog.pg_class t
  join pg_catalog.pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public' and t.relkind in ('r', 'p')
),
audit_policies as (
  select coalesce(json_agg(json_build_object(
    'table', p.tablename,
    'policy', p.policyname,
    'command', p.cmd,
    'permissive', p.permissive,
    'roles', p.roles,
    'using', p.qual,
    'with_check', p.with_check
  ) order by p.tablename, p.policyname), '[]'::json) as value
  from pg_catalog.pg_policies p
  where p.schemaname = 'public'
),
audit_foreign_keys as (
  select coalesce(json_agg(json_build_object(
    'table', cl.relname,
    'constraint', con.conname,
    'references', format('%I.%I', rn.nspname, rc.relname),
    'definition', pg_catalog.pg_get_constraintdef(con.oid),
    'on_delete', case con.confdeltype when 'a' then 'no action' when 'r' then 'restrict'
                   when 'c' then 'cascade' when 'n' then 'set null' when 'd' then 'set default' end
  ) order by cl.relname, con.conname), '[]'::json) as value
  from pg_catalog.pg_constraint con
  join pg_catalog.pg_class cl on cl.oid = con.conrelid
  join pg_catalog.pg_namespace n on n.oid = cl.relnamespace
  join pg_catalog.pg_class rc on rc.oid = con.confrelid
  join pg_catalog.pg_namespace rn on rn.oid = rc.relnamespace
  where con.contype = 'f' and n.nspname = 'public'
),
public_functions as (
  select p.oid, p.proname, p.prosecdef, p.provolatile, p.proconfig, p.proacl, p.prolang,
         pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and not exists (
      select 1 from pg_catalog.pg_depend dep
      where dep.classid = 'pg_catalog.pg_proc'::regclass and dep.objid = p.oid and dep.deptype = 'e'
    )
),
audit_functions as (
  select coalesce(json_agg(json_build_object(
    'function', f.proname,
    'arguments', f.arguments,
    'returns', pg_catalog.pg_get_function_result(f.oid),
    'language', l.lanname,
    'security_definer', f.prosecdef,
    'volatility', case f.provolatile when 'i' then 'immutable' when 's' then 'stable' else 'volatile' end,
    'config', f.proconfig,
    'proacl', f.proacl::text[]
  ) order by f.proname, f.arguments), '[]'::json) as value
  from public_functions f
  join pg_catalog.pg_language l on l.oid = f.prolang
),
audit_table_grants as (
  select coalesce(json_agg(json_build_object(
    'table', t.relname,
    'anon', array(
      select privilege from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as privilege
      where pg_catalog.has_table_privilege('anon', t.oid, privilege)),
    'authenticated', array(
      select privilege from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as privilege
      where pg_catalog.has_table_privilege('authenticated', t.oid, privilege)),
    'service_role', array(
      select privilege from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as privilege
      where pg_catalog.has_table_privilege('service_role', t.oid, privilege)),
    -- Grants on single columns, which the table-level lists above do not show:
    -- after `revoke update` plus `grant update (some_column)`, UPDATE is gone
    -- from the table list but those columns can still be written.
    'column_grants', coalesce((
      select json_agg(json_build_object(
        'column', a.attname,
        'grantee', case when acl.grantee = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(acl.grantee) end,
        'privilege', acl.privilege_type
      ) order by a.attname, pg_catalog.pg_get_userbyid(acl.grantee), acl.privilege_type)
      from pg_catalog.pg_attribute a
      cross join lateral pg_catalog.aclexplode(a.attacl) as acl
      where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped and a.attacl is not null
        and (acl.grantee = 0 or pg_catalog.pg_get_userbyid(acl.grantee) in ('anon', 'authenticated'))
    ), '[]'::json)
  ) order by t.relname), '[]'::json) as value
  from pg_catalog.pg_class t
  join pg_catalog.pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public' and t.relkind in ('r', 'p', 'v', 'm')
),
audit_function_grants as (
  select coalesce(json_agg(json_build_object(
    'function', f.proname,
    'arguments', f.arguments,
    'anon_execute', pg_catalog.has_function_privilege('anon', f.oid, 'EXECUTE'),
    'authenticated_execute', pg_catalog.has_function_privilege('authenticated', f.oid, 'EXECUTE'),
    'service_role_execute', pg_catalog.has_function_privilege('service_role', f.oid, 'EXECUTE')
  ) order by f.proname, f.arguments), '[]'::json) as value
  from public_functions f
),
audit_triggers as (
  select coalesce(json_agg(json_build_object(
    'table', format('%I.%I', n.nspname, c.relname),
    'trigger', tg.tgname,
    'enabled', tg.tgenabled <> 'D',
    'definition', pg_catalog.pg_get_triggerdef(tg.oid)
  ) order by n.nspname, c.relname, tg.tgname), '[]'::json) as value
  from pg_catalog.pg_trigger tg
  join pg_catalog.pg_class c on c.oid = tg.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where not tg.tgisinternal
    and (n.nspname = 'public' or (n.nspname = 'auth' and c.relname = 'users'))
),
audit_extensions as (
  select coalesce(json_agg(json_build_object(
    'extension', e.extname,
    'version', e.extversion,
    'schema', n.nspname
  ) order by e.extname), '[]'::json) as value
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
),
audit_roles as (
  select coalesce(json_agg(json_build_object(
    'role', r.rolname,
    'superuser', r.rolsuper,
    'bypass_rls', r.rolbypassrls,
    'inherit', r.rolinherit,
    'can_login', r.rolcanlogin
  ) order by r.rolname), '[]'::json) as value
  from pg_catalog.pg_roles r
  where r.rolname in ('anon', 'authenticated', 'service_role', 'authenticator')
),
audit_default_privileges as (
  select coalesce(json_agg(json_build_object(
    'owner', pg_catalog.pg_get_userbyid(d.defaclrole),
    'schema', n.nspname,
    'object_type', case d.defaclobjtype when 'r' then 'tables' when 'S' then 'sequences'
                     when 'f' then 'functions' when 'T' then 'types' when 'n' then 'schemas'
                     else d.defaclobjtype::text end,
    'acl', d.defaclacl::text[]
  ) order by pg_catalog.pg_get_userbyid(d.defaclrole), n.nspname, d.defaclobjtype), '[]'::json) as value
  from pg_catalog.pg_default_acl d
  left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
  where n.nspname = 'public' or d.defaclnamespace = 0
),
audit_auth_users_columns as (
  select json_agg(json_build_object(
    'name', a.attname,
    'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
    'nullable', not a.attnotnull
  ) order by a.attnum) as value
  from pg_catalog.pg_attribute a
  where a.attrelid = to_regclass('auth.users') and a.attnum > 0 and not a.attisdropped
),
-- The ledger is read through query_to_xml so that this statement still parses
-- and returns null on a database without the supabase_migrations schema. Only
-- version and name are read: the table can also hold the full SQL of each
-- migration and the email of whoever applied it.
audit_ledger as (
  select case
    when to_regclass('supabase_migrations.schema_migrations') is null then null
    else (
      select coalesce(json_agg(json_build_object(
        'version', (xpath('/row/version/text()', ledger.entry))[1]::text,
        'name', (xpath('/row/name/text()', ledger.entry))[1]::text
      ) order by ledger.position), '[]'::json)
      from unnest(xpath('/table/row', query_to_xml(
        case when exists (
          select 1 from pg_catalog.pg_attribute
          where attrelid = to_regclass('supabase_migrations.schema_migrations')
            and attname = 'name' and not attisdropped
        )
          then 'select version, name from supabase_migrations.schema_migrations order by version'
          else 'select version from supabase_migrations.schema_migrations order by version'
        end,
        false, false, ''))) with ordinality as ledger (entry, position)
    )
  end as value
)
select json_build_object(
  'audit_version', 1,
  'server_version_num', current_setting('server_version_num'),
  'tables', (select value from audit_tables),
  'policies', (select value from audit_policies),
  'foreign_keys', (select value from audit_foreign_keys),
  'functions', (select value from audit_functions),
  'table_grants', (select value from audit_table_grants),
  'function_grants', (select value from audit_function_grants),
  'triggers', (select value from audit_triggers),
  'extensions', (select value from audit_extensions),
  'roles', (select value from audit_roles),
  'default_privileges', (select value from audit_default_privileges),
  'auth_users_columns', (select value from audit_auth_users_columns),
  'supabase_migrations_ledger', (select value from audit_ledger)
) as halo_baseline_audit;
