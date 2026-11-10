-- Apply as administrator. This role has no password/login until credentials are configured securely.
CREATE ROLE line_kr_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE SCHEMA line_kr;
REVOKE ALL ON SCHEMA line_kr FROM PUBLIC;
GRANT USAGE ON SCHEMA line_kr TO line_kr_app;
ALTER ROLE line_kr_app SET search_path = line_kr;
ALTER ROLE line_kr_app SET timezone = 'Asia/Seoul';
