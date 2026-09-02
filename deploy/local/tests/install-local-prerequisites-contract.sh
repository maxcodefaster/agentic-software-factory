#!/bin/sh
# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
output=$("$root/scripts/install-local-prerequisites.sh")
printf '%s' "$output" | grep -Fq 'ingress-nginx chart 4.13.2'
printf '%s' "$output" | grep -Fq 'cert-manager chart v1.21.1'
printf '%s' "$output" | grep -Fq 'CloudNativePG chart 0.27.1'
printf '%s' "$output" | grep -Fq 'ClusterIssuer aaf-local-ca'
if grep -Fq 'controller.allowSnippetAnnotations=true' "$root/scripts/install-local-prerequisites.sh"; then exit 1; fi
grep -Fq 'crds.enabled=true' "$root/scripts/install-local-prerequisites.sh"
grep -Fq 'kubectl get secret aaf-local-ca -n cert-manager -o json' "$root/scripts/install-local-prerequisites.sh"
grep -Fq 'condition=Ready clusterissuer/aaf-local-ca' "$root/scripts/install-local-prerequisites.sh"
if grep -Eq 'security add-trusted-cert|sudo' "$root/scripts/install-local-prerequisites.sh"; then exit 1; fi
grep -Fq 'name: coredns-custom' "$root/scripts/install-local-prerequisites.sh"
grep -Fq 'rewrite name exact factory.localhost ingress-nginx-controller.ingress-nginx.svc.cluster.local' "$root/scripts/install-local-prerequisites.sh"
test "$(grep -Fc 'current_dns_config=$(kubectl get configmap coredns-custom' "$root/scripts/install-local-prerequisites.sh")" -eq 2
apply_line=$(grep -n 'kubectl apply -f -' "$root/scripts/install-local-prerequisites.sh" | sed -n '1s/:.*//p')
reread_line=$(grep -n 'current_dns_config=$(kubectl get configmap coredns-custom' "$root/scripts/install-local-prerequisites.sh" | sed -n '2s/:.*//p')
test "$apply_line" -lt "$reread_line"
printf 'Local prerequisite contract passed.\n'
