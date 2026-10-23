#!/bin/sh
set -eu
psql --username "$POSTGRES_USER" --dbname postgres --set=ON_ERROR_STOP=1 --set=app_password="$SHIWUGUAN_APP_PASSWORD" <<'SQL'
CREATE ROLE shiwuguan LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE shiwuguan OWNER shiwuguan;
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
SQL
