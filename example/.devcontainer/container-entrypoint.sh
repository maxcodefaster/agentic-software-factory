#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -u

child_pid=
shutting_down=false

shutdown() {
  [ "$shutting_down" = false ] || return
  shutting_down=true
  trap - TERM INT

  process-compose --address 127.0.0.1 --port 8080 --ordered-shutdown down >/dev/null 2>&1 || {
    if [ -n "${PGDATA:-}" ] && [ -s "$PGDATA/PG_VERSION" ]; then
      pg_ctl --pgdata "$PGDATA" stop --mode fast --wait >/dev/null 2>&1 || true
    fi
  }
  if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
    kill -TERM "$child_pid"
  fi
}

trap shutdown TERM INT
"$@" &
child_pid=$!
wait "$child_pid"
status=$?
wait "$child_pid" 2>/dev/null || true
exit "$status"
