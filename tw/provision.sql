-- Review and run as the existing DB administrator after authorization.
-- This creates only Taiwan objects; it does not grant access to Japanese tables.
CREATE SCHEMA IF NOT EXISTS line_tw;
-- Stop for review if this role already exists; do not reuse unknown privileges.
CREATE ROLE line_tw_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT USAGE, CREATE ON SCHEMA line_tw TO line_tw_app;
-- No password is supplied here. Set it securely outside source code before use.
-- Use the same database name with role line_tw_app in TW_DATABASE_URL.
