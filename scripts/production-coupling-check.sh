#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
patterns='k8s\.orb\.local|/Users/|FORGEJO_APPLICATION_REPOSITORY|FACTORY_APPLICATION_TEAM'

if grep -Ern --include='*.ts' --include='*.tsx' --include='*.tf' --include='*.yaml' --include='*.yml' --include='*.sh' \
  --exclude='*.test.ts' --exclude='*.spec.ts' --exclude='validate.sh' \
  "$patterns" \
  "$root/apps/bff/src" \
  "$root/packages/db/src" \
  "$root/templates/agentic-software-factory" \
  "$root/deploy/production"; then
  printf '%s\n' 'Production or generic automation contains a demo/customer coupling.' >&2
  exit 1
fi

printf '%s\n' 'Production coupling check passed.'
