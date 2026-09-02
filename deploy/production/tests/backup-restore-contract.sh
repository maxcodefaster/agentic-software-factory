#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir "$tmp/bin"

cat >"$tmp/bin/pg_dump" <<'SH'
#!/bin/sh
for argument in "$@"; do case "$argument" in --file=*) file=${argument#--file=} ;; esac; done
printf 'safe backup\n' >"$file"
SH
cat >"$tmp/bin/pg_restore" <<'SH'
#!/bin/sh
exit 0
SH
cat >"$tmp/bin/psql" <<'SH'
#!/bin/sh
case "$*" in *'select count(*) from system_registration'*|*'select count(*) from delivery'*|*'select count(*) from staging_reconciliation'*) exit 0 ;; *) exit 1 ;; esac
SH
chmod +x "$tmp/bin/pg_dump" "$tmp/bin/pg_restore" "$tmp/bin/psql"

PATH="$tmp/bin:$PATH" DATABASE_URL=postgres://source BACKUP_FILE="$tmp/backup.dump" sh "$root/deploy/production/backup-restore.sh" backup >/dev/null
PATH="$tmp/bin:$PATH" DATABASE_URL=postgres://source BACKUP_FILE="$tmp/backup.dump" sh "$root/deploy/production/backup-restore.sh" verify >/dev/null
PATH="$tmp/bin:$PATH" DATABASE_URL=postgres://source RESTORE_DATABASE_URL=postgres://restore BACKUP_FILE="$tmp/backup.dump" sh "$root/deploy/production/backup-restore.sh" restore-test | grep -q '^restore_rto_seconds='
if PATH="$tmp/bin:$PATH" DATABASE_URL=postgres://source RESTORE_DATABASE_URL=postgres://source BACKUP_FILE="$tmp/backup.dump" sh "$root/deploy/production/backup-restore.sh" restore-test 2>/dev/null; then
  exit 1
fi
printf '%s\n' 'Backup and isolated restore contract passed.'
