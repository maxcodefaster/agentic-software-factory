#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

database=${POSTGRES_DB:-factory_app}
user=${POSTGRES_USER:-factory_app}
password=${POSTGRES_PASSWORD:-factory_app}

psql --username "$user" --dbname postgres --set ON_ERROR_STOP=1 \
  --set database="$database" --set user="$user" --set password="$password" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'user', :'password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'user') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'database', :'user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'database') \gexec
SQL

bun --no-env-file run db:migrate
