# Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
#
# All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.

FROM postgres:17-bookworm@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0 AS base

ARG TARGETARCH
ARG BUN_VERSION=1.3.14
ARG PROCESS_COMPOSE_VERSION=1.122.0

ENV PATH="/usr/lib/postgresql/17/bin:${PATH}"
ENV PGDATA=/home/vscode/.local/share/devcontainer/postgres

RUN target_arch="${TARGETARCH:-$(dpkg --print-architecture)}" \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git unzip \
 && case "${target_arch}" in \
      amd64) bun_arch=x64; bun_sha=951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f; pc_sha=9b6dbc38324c0b0481f1cd1dd828ffdc78117129ec797678f4bf8c4023311281 ;; \
      arm64) bun_arch=aarch64; bun_sha=a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b; pc_sha=52fa7d5a2d5e0db470faec5976204fc215ed7e3d13689e930cf522becfb63778 ;; \
      *) echo "Unsupported architecture: ${target_arch}" >&2; exit 1 ;; \
    esac \
 && curl --fail --location --silent --show-error \
      "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-${bun_arch}.zip" \
      --output /tmp/bun.zip \
 && echo "${bun_sha}  /tmp/bun.zip" | sha256sum --check --strict \
 && unzip -q /tmp/bun.zip -d /tmp/bun \
 && install -m 0755 "/tmp/bun/bun-linux-${bun_arch}/bun" /usr/local/bin/bun \
 && curl --fail --location --silent --show-error \
      "https://github.com/F1bonacc1/process-compose/releases/download/v${PROCESS_COMPOSE_VERSION}/process-compose_linux_${target_arch}.tar.gz" \
      --output /tmp/process-compose.tar.gz \
 && echo "${pc_sha}  /tmp/process-compose.tar.gz" | sha256sum --check --strict \
 && tar --extract --gzip --file /tmp/process-compose.tar.gz --directory /usr/local/bin process-compose \
 && chmod 0755 /usr/local/bin/process-compose \
 && groupadd --gid 1000 vscode \
 && useradd --uid 1000 --gid vscode --create-home --shell /bin/sh vscode \
 && install --directory --owner=vscode --group=vscode \
      /home/vscode/.local/share/devcontainer/postgres \
      /home/vscode/.local/share/devcontainer-verification \
      /home/vscode/.local/state/devcontainer \
      /home/vscode/.local/state/devcontainer-verification \
      /workspaces \
      /home/vscode/.config/process-compose \
 && install --directory --owner=vscode --group=vscode /var/run/postgresql \
 && chown vscode:vscode /var/run/postgresql \
 && rm -rf /var/lib/apt/lists/* /tmp/*

COPY .devcontainer/container-entrypoint.sh /usr/local/bin/agentic-software-factory-entrypoint
RUN chmod 0755 /usr/local/bin/agentic-software-factory-entrypoint

USER vscode
WORKDIR /workspaces/project
ENTRYPOINT ["/usr/local/bin/agentic-software-factory-entrypoint"]
CMD ["sleep", "infinity"]
STOPSIGNAL SIGTERM

FROM base AS developer
