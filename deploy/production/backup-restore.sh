#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_FILE:?BACKUP_FILE is required}"
mode=${1:-verify}

case "$mode" in
  backup)
    umask 077
    started=$(date +%s)
    pg_dump --format=custom --no-owner --no-acl --file="$BACKUP_FILE" "$DATABASE_URL"
    pg_restore --list "$BACKUP_FILE" >/dev/null
    sha256sum "$BACKUP_FILE" >"$BACKUP_FILE.sha256"
    printf 'backup_duration_seconds=%s\n' "$(( $(date +%s) - started ))"
    ;;
  verify)
    test -s "$BACKUP_FILE"
    test -s "$BACKUP_FILE.sha256"
    sha256sum -c "$BACKUP_FILE.sha256"
    pg_restore --list "$BACKUP_FILE" >/dev/null
    ;;
  restore-test)
    : "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL must point to an empty isolated database}"
    test "$RESTORE_DATABASE_URL" != "$DATABASE_URL"
    started=$(date +%s)
    pg_restore --exit-on-error --no-owner --no-acl --dbname="$RESTORE_DATABASE_URL" "$BACKUP_FILE"
    psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'select count(*) from system_registration' >/dev/null
    psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'select count(*) from delivery' >/dev/null
    psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'select count(*) from staging_reconciliation' >/dev/null
    printf 'restore_rto_seconds=%s\n' "$(( $(date +%s) - started ))"
    ;;
  *)
    printf 'usage: %s backup|verify|restore-test\n' "$0" >&2
    exit 2
    ;;
esac
