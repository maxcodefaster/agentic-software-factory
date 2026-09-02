#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
cat >"$tmp/kubectl" <<'SH'
#!/bin/sh
set -eu
printf '%s\n' "$*" >>"$CALLS"
case "$*" in
  *'get pvc'*'workspace-id'*) printf workspace-1 ;;
  *'get pvc'*'user-id'*) printf user-1 ;;
  *'get pvc'*'tenant'*) printf tenant ;;
  *'get pvc'*'storageClassName'*) printf encrypted-workspaces ;;
  *'get volumesnapshot'*'workspace-id'*) printf workspace-1 ;;
  *'get volumesnapshot'*'user-id'*) printf user-1 ;;
  *'get volumesnapshot'*'tenant'*) printf tenant ;;
  *'get volumesnapshot'*'storage-class'*) printf encrypted-workspaces ;;
  *'get volumesnapshot'*'snapshot-driver'*) printf csi.example.test ;;
  *'get volumesnapshot'*'volumeSnapshotClassName'*) printf encrypted-csi ;;
  *'get volumesnapshot'*'readyToUse'*) printf true ;;
  'get storageclass encrypted-workspaces -o jsonpath={.provisioner}') printf csi.example.test ;;
  'get volumesnapshotclass encrypted-csi -o jsonpath={.driver}') printf csi.example.test ;;
  'get deployment coder-workspace-1 -n workspaces') exit 1 ;;
  'get pvc coder-workspace-1-state -n workspaces') exit 0 ;;
  'delete pvc coder-workspace-1-state -n workspaces') exit 0 ;;
  *'apply -f -'*) tee -a "$MANIFESTS" >/dev/null ;;
esac
SH
chmod +x "$tmp/kubectl"

CALLS="$tmp/calls" MANIFESTS="$tmp/manifests" KUBECTL="$tmp/kubectl" NAMESPACE=workspaces TENANT_ID=tenant SNAPSHOT_CLASS=encrypted-csi \
  sh "$root/deploy/production/workspace-snapshot.sh" snapshot coder-workspace-1-state snapshot-1
CALLS="$tmp/calls" MANIFESTS="$tmp/manifests" KUBECTL="$tmp/kubectl" NAMESPACE=workspaces TENANT_ID=tenant SNAPSHOT_CLASS=encrypted-csi \
  sh "$root/deploy/production/workspace-snapshot.sh" restore snapshot-1 12Gi
grep -q 'persistentVolumeClaimName: coder-workspace-1-state' "$tmp/manifests"
grep -q 'volumeSnapshotClassName: encrypted-csi' "$tmp/manifests"
test "$(grep -c 'name: coder-workspace-1-state' "$tmp/manifests")" -eq 1
grep -q 'coder.com/workspace-id: workspace-1' "$tmp/manifests"
grep -q 'coder.com/user-id: user-1' "$tmp/manifests"
grep -q 'factory.application/storage-class: encrypted-workspaces' "$tmp/manifests"
grep -q 'factory.application/snapshot-driver: csi.example.test' "$tmp/manifests"
grep -q 'storageClassName: encrypted-workspaces' "$tmp/manifests"
grep -q 'storage: 12Gi' "$tmp/manifests"
grep -q 'kind: VolumeSnapshot' "$tmp/manifests"
! grep -Eqi 'credential|secret' "$tmp/manifests"
delete_line=$(grep -n '^delete pvc coder-workspace-1-state -n workspaces$' "$tmp/calls" | sed -n '1s/:.*//p')
apply_lines=$(grep -n '^apply -f -$' "$tmp/calls" | sed 's/:.*//')
restore_apply_line=$(printf '%s\n' "$apply_lines" | sed -n '2p')
test -n "$delete_line" && test -n "$restore_apply_line" && test "$delete_line" -lt "$restore_apply_line"

cat >"$tmp/kubectl-present" <<'SH'
#!/bin/sh
case "$*" in
  *'get volumesnapshot'*'tenant'*) printf tenant ;;
  *'get volumesnapshot'*'workspace-id'*) printf workspace-1 ;;
  *'get volumesnapshot'*'user-id'*) printf user-1 ;;
  *'get volumesnapshot'*'storage-class'*) printf encrypted-workspaces ;;
  *'get volumesnapshot'*'snapshot-driver'*) printf csi.example.test ;;
  *'get volumesnapshot'*'volumeSnapshotClassName'*) printf encrypted-csi ;;
  *'get volumesnapshot'*'readyToUse'*) printf true ;;
  'get storageclass encrypted-workspaces -o jsonpath={.provisioner}') printf csi.example.test ;;
  'get volumesnapshotclass encrypted-csi -o jsonpath={.driver}') printf csi.example.test ;;
  'get deployment coder-workspace-1 -n workspaces') exit 0 ;;
  *) exit 1 ;;
esac
SH
chmod +x "$tmp/kubectl-present"
if KUBECTL="$tmp/kubectl-present" NAMESPACE=workspaces TENANT_ID=tenant SNAPSHOT_CLASS=encrypted-csi \
  sh "$root/deploy/production/workspace-snapshot.sh" restore snapshot-1 12Gi >"$tmp/running-output" 2>&1; then
  exit 1
fi
grep -Fq 'Stop the existing Coder workspace; do not delete it.' "$tmp/running-output"

cat >"$tmp/kubectl-deleted" <<'SH'
#!/bin/sh
case "$*" in
  *'get volumesnapshot'*'tenant'*) printf tenant ;;
  *'get volumesnapshot'*'workspace-id'*) printf workspace-1 ;;
  *'get volumesnapshot'*'user-id'*) printf user-1 ;;
  *'get volumesnapshot'*'storage-class'*) printf encrypted-workspaces ;;
  *'get volumesnapshot'*'snapshot-driver'*) printf csi.example.test ;;
  *'get volumesnapshot'*'volumeSnapshotClassName'*) printf encrypted-csi ;;
  *'get volumesnapshot'*'readyToUse'*) printf true ;;
  'get storageclass encrypted-workspaces -o jsonpath={.provisioner}') printf csi.example.test ;;
  'get volumesnapshotclass encrypted-csi -o jsonpath={.driver}') printf csi.example.test ;;
  'get deployment coder-workspace-1 -n workspaces') exit 1 ;;
  'get pvc coder-workspace-1-state -n workspaces') exit 1 ;;
  *) exit 1 ;;
esac
SH
chmod +x "$tmp/kubectl-deleted"
if KUBECTL="$tmp/kubectl-deleted" NAMESPACE=workspaces TENANT_ID=tenant SNAPSHOT_CLASS=encrypted-csi \
  sh "$root/deploy/production/workspace-snapshot.sh" restore snapshot-1 12Gi >"$tmp/deleted-output" 2>&1; then
  exit 1
fi
grep -Fq 'Do not delete the Coder workspace or PVC before restore.' "$tmp/deleted-output"

cat >"$tmp/kubectl-incompatible" <<'SH'
#!/bin/sh
case "$*" in
  *'get pvc'*'workspace-id'*) printf workspace-1 ;;
  *'get pvc'*'user-id'*) printf user-1 ;;
  *'get pvc'*'tenant'*) printf tenant ;;
  *'get pvc'*'storageClassName'*) printf encrypted-workspaces ;;
  'get storageclass encrypted-workspaces -o jsonpath={.provisioner}') printf csi.storage.test ;;
  'get volumesnapshotclass encrypted-csi -o jsonpath={.driver}') printf other.csi.test ;;
  *) exit 1 ;;
esac
SH
chmod +x "$tmp/kubectl-incompatible"
if KUBECTL="$tmp/kubectl-incompatible" NAMESPACE=workspaces TENANT_ID=tenant SNAPSHOT_CLASS=encrypted-csi \
  sh "$root/deploy/production/workspace-snapshot.sh" snapshot coder-workspace-1-state snapshot-2 >"$tmp/incompatible-output" 2>&1; then
  exit 1
fi
grep -Fq 'StorageClass encrypted-workspaces uses csi.storage.test, but VolumeSnapshotClass encrypted-csi uses other.csi.test.' "$tmp/incompatible-output"
printf '%s\n' 'Workspace snapshot and restore contract passed.'
