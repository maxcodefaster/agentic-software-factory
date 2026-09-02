#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu
: "${NAMESPACE:?NAMESPACE is required}"
: "${TENANT_ID:?TENANT_ID is required}"
: "${SNAPSHOT_CLASS:?SNAPSHOT_CLASS is required}"
kubectl=${KUBECTL:-kubectl}
mode=${1:-}

case "$mode" in
  snapshot)
    pvc=${2:?PVC name is required}
    snapshot=${3:?snapshot name is required}
    tenant=$($kubectl get pvc "$pvc" -n "$NAMESPACE" -o 'jsonpath={.metadata.labels.factory\.application/tenant}')
    test "$tenant" = "$TENANT_ID"
    workspace_id=$($kubectl get pvc "$pvc" -n "$NAMESPACE" -o 'jsonpath={.metadata.labels.coder\.com/workspace-id}')
    user_id=$($kubectl get pvc "$pvc" -n "$NAMESPACE" -o 'jsonpath={.metadata.labels.coder\.com/user-id}')
    storage_class=$($kubectl get pvc "$pvc" -n "$NAMESPACE" -o 'jsonpath={.spec.storageClassName}')
    test -n "$workspace_id"
    test -n "$user_id"
    test -n "$storage_class"
    test "$pvc" = "coder-$workspace_id-state"
    storage_driver=$($kubectl get storageclass "$storage_class" -o 'jsonpath={.provisioner}')
    snapshot_driver=$($kubectl get volumesnapshotclass "$SNAPSHOT_CLASS" -o 'jsonpath={.driver}')
    test -n "$storage_driver"
    test "$storage_driver" = "$snapshot_driver" || {
      printf 'StorageClass %s uses %s, but VolumeSnapshotClass %s uses %s.\n' "$storage_class" "$storage_driver" "$SNAPSHOT_CLASS" "$snapshot_driver" >&2
      exit 1
    }
    $kubectl apply -f - <<YAML
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: $snapshot
  namespace: $NAMESPACE
  labels:
    factory.application/tenant: $TENANT_ID
    coder.com/workspace-id: $workspace_id
    coder.com/user-id: $user_id
  annotations:
    factory.application/storage-class: $storage_class
    factory.application/snapshot-driver: $snapshot_driver
spec:
  volumeSnapshotClassName: $SNAPSHOT_CLASS
  source:
    persistentVolumeClaimName: $pvc
YAML
    $kubectl wait --for=jsonpath='{.status.readyToUse}'=true "volumesnapshot/$snapshot" -n "$NAMESPACE" --timeout=10m
    ;;
  restore)
    snapshot=${2:?snapshot name is required}
    storage=${3:-10Gi}
    tenant=$($kubectl get volumesnapshot "$snapshot" -n "$NAMESPACE" -o 'jsonpath={.metadata.labels.factory\.application/tenant}')
    workspace_id=$($kubectl get volumesnapshot "$snapshot" -n "$NAMESPACE" -o 'jsonpath={.metadata.labels.coder\.com/workspace-id}')
    user_id=$($kubectl get volumesnapshot "$snapshot" -n "$NAMESPACE" -o 'jsonpath={.metadata.labels.coder\.com/user-id}')
    storage_class=$($kubectl get volumesnapshot "$snapshot" -n "$NAMESPACE" -o 'jsonpath={.metadata.annotations.factory\.application/storage-class}')
    recorded_driver=$($kubectl get volumesnapshot "$snapshot" -n "$NAMESPACE" -o 'jsonpath={.metadata.annotations.factory\.application/snapshot-driver}')
    snapshot_class=$($kubectl get volumesnapshot "$snapshot" -n "$NAMESPACE" -o 'jsonpath={.spec.volumeSnapshotClassName}')
    ready=$($kubectl get volumesnapshot "$snapshot" -n "$NAMESPACE" -o 'jsonpath={.status.readyToUse}')
    test "$tenant" = "$TENANT_ID"
    test -n "$workspace_id"
    test -n "$user_id"
    test -n "$storage_class"
    test -n "$recorded_driver"
    test "$ready" = true
    test "$snapshot_class" = "$SNAPSHOT_CLASS" || {
      printf 'Snapshot %s uses VolumeSnapshotClass %s, not %s.\n' "$snapshot" "$snapshot_class" "$SNAPSHOT_CLASS" >&2
      exit 1
    }
    snapshot_driver=$($kubectl get volumesnapshotclass "$snapshot_class" -o 'jsonpath={.driver}')
    storage_driver=$($kubectl get storageclass "$storage_class" -o 'jsonpath={.provisioner}')
    test "$snapshot_driver" = "$recorded_driver" || {
      printf 'VolumeSnapshotClass %s driver changed from %s to %s.\n' "$snapshot_class" "$recorded_driver" "$snapshot_driver" >&2
      exit 1
    }
    test "$storage_driver" = "$recorded_driver" || {
      printf 'StorageClass %s driver %s is incompatible with snapshot driver %s.\n' "$storage_class" "$storage_driver" "$recorded_driver" >&2
      exit 1
    }
    target="coder-$workspace_id-state"
    deployment="coder-$workspace_id"
    if $kubectl get deployment "$deployment" -n "$NAMESPACE" >/dev/null 2>&1; then
      printf 'Refusing restore while workspace Deployment %s exists. Stop the existing Coder workspace; do not delete it.\n' "$deployment" >&2
      exit 1
    fi
    if ! $kubectl get pvc "$target" -n "$NAMESPACE" >/dev/null 2>&1; then
      printf 'Fixed state PVC %s is missing. Do not delete the Coder workspace or PVC before restore.\n' "$target" >&2
      exit 1
    fi
    current_tenant=$($kubectl get pvc "$target" -n "$NAMESPACE" -o 'jsonpath={.metadata.labels.factory\.application/tenant}')
    current_workspace_id=$($kubectl get pvc "$target" -n "$NAMESPACE" -o 'jsonpath={.metadata.labels.coder\.com/workspace-id}')
    current_user_id=$($kubectl get pvc "$target" -n "$NAMESPACE" -o 'jsonpath={.metadata.labels.coder\.com/user-id}')
    current_storage_class=$($kubectl get pvc "$target" -n "$NAMESPACE" -o 'jsonpath={.spec.storageClassName}')
    test "$current_tenant" = "$TENANT_ID"
    test "$current_workspace_id" = "$workspace_id"
    test "$current_user_id" = "$user_id"
    test "$current_storage_class" = "$storage_class"
    $kubectl delete pvc "$target" -n "$NAMESPACE"
    $kubectl wait --for=delete "pvc/$target" -n "$NAMESPACE" --timeout=10m
    $kubectl apply -f - <<YAML
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: $target
  namespace: $NAMESPACE
  labels:
    factory.application/tenant: $TENANT_ID
    coder.com/workspace-id: $workspace_id
    coder.com/user-id: $user_id
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: $storage_class
  resources:
    requests:
      storage: $storage
  dataSource:
    name: $snapshot
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
YAML
    $kubectl wait --for=jsonpath='{.status.phase}'=Bound "pvc/$target" -n "$NAMESPACE" --timeout=10m
    ;;
  *)
    printf 'usage: %s snapshot FIXED_PVC SNAPSHOT | restore SNAPSHOT [SIZE]\n' "$0" >&2
    exit 2
    ;;
esac
