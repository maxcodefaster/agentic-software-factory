#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
[ -f .env ] || bun run setup
runtime_directory=${PROCESS_COMPOSE_LOG_DIRECTORY:-.process-compose}
config=${PROCESS_COMPOSE_CONFIG:-.devcontainer/process-compose.yaml}
mkdir -p "$runtime_directory" "$PGDATA"
chmod 0700 "$PGDATA"

if process-compose --address 127.0.0.1 --port 8080 process list >/dev/null 2>&1; then
  exit 0
fi
if [ -f "$PGDATA/postmaster.pid" ]; then
  if pg_ctl --pgdata "$PGDATA" status >/dev/null 2>&1; then
    printf '%s\n' 'PostgreSQL is already running outside process-compose.' >&2
    exit 1
  fi
  rm -f "$PGDATA/postmaster.pid"
fi

export BETTER_AUTH_ENABLE_SIGN_UP=true
exec process-compose --address 127.0.0.1 --port 8080 \
  --log-file "$runtime_directory/process-compose.log" --ordered-shutdown \
  --config "$config" up --detached
