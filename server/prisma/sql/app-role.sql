-- Least-privilege runtime role for the API server (plan/database/11 step 1).
--
-- Run it AS THE MIGRATION OWNER (the role that owns the tables), after `prisma migrate deploy`.
-- It is idempotent; re-run it after new migrations (default privileges already cover new tables and functions).
--
--   Local:       npm run db:app-role
--                (= docker compose exec -T postgres psql -U grocerez -d grocerez -v ON_ERROR_STOP=1 < prisma/sql/app-role.sql)
--   Production:  psql "$OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 -v app_password="$GROCEREZ_APP_PASSWORD" -f prisma/sql/app-role.sql
--
-- The server then connects as grocerez_app:
--   DATABASE_URL=postgresql://grocerez_app:<password>@<host>:5432/<db>?sslmode=require
-- Migrations and the seed keep using the owner role (MIGRATE_DATABASE_URL, read by prisma.config.ts).

\if :{?app_password}
\else
  \set app_password 'grocerez_app'
  \echo 'app_password not given: using the local-dev password grocerez_app (never use it in production)'
\endif

-- Role (LOGIN only: no superuser, no createdb, no createrole, no inheritance tricks).
SELECT 'CREATE ROLE grocerez_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'grocerez_app') \gexec
ALTER ROLE grocerez_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'app_password';
ALTER ROLE grocerez_app SET statement_timeout = '15s';

SELECT format('GRANT CONNECT ON DATABASE %I TO grocerez_app', current_database()) \gexec

-- No DDL: nobody but the owner may create objects in public.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM grocerez_app;
GRANT USAGE ON SCHEMA public TO grocerez_app;

-- Data access only: SELECT, INSERT, UPDATE, DELETE (no TRUNCATE, REFERENCES, TRIGGER; no ownership, so no DROP/ALTER).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO grocerez_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO grocerez_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO grocerez_app;

-- The app has no business reading or changing migration history.
REVOKE ALL ON TABLE _prisma_migrations FROM grocerez_app;

-- Tables/functions created by future migrations (run by this same owner) get the same grants automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO grocerez_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO grocerez_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO grocerez_app;
