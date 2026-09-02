/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

export interface WorkspaceApplication {
  slug: string;
  displayName?: string;
  url: string;
  icon?: string;
  openIn?: 'tab' | 'slim-window';
  share?: 'owner' | 'authenticated';
  group?: string;
  order?: number;
  healthCheck?: {
    url: string;
    interval: number;
    threshold: number;
  };
}

export interface WorkspaceContract {
  apps: WorkspaceApplication[];
  devcontainerPath?: string;
  supervisorCommands?: {
    status: string;
    attach?: string;
    logs?: string;
    restart?: string;
    shutdown: string;
  };
  shutdownCommand?: string;
  startupTimeoutSeconds?: number;
  contractVersion?: number;
  tenantId?: string;
}

export interface DeclaredApplication {
  slug: string;
  displayName: string;
}
