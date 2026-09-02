/*
 * Unless explicitly acquired and licensed from Licensor under another license, the contents of this file are subject to the Reciprocal Public License ("RPL") Version 1.5, or subsequent versions as allowed by the RPL, and You may not copy or use this file in either source code or executable form, except in compliance with the terms and conditions of the RPL.
 *
 * All software distributed under the RPL is provided strictly on an "AS IS" basis, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS OR IMPLIED, AND LICENSOR HEREBY DISCLAIMS ALL SUCH WARRANTIES, INCLUDING WITHOUT LIMITATION, ANY WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, QUIET ENJOYMENT, OR NON-INFRINGEMENT. See the RPL for specific language governing rights and limitations under the RPL.
 */

export interface ForgejoTeamAccess {
  name: string;
  usernames: string[];
  repositories: string[];
}

export function forgejoTeamAccess(input: {
  baseTeam: string;
  tenantTeam: string;
  tenantGroup: string;
  teams: Array<{ slug: string; group: string | null }>;
  applications: Array<{ team: string; repositoryName: string }>;
  users: Array<{ username: string; groups: string[] }>;
  serviceUsers: string[];
}): ForgejoTeamAccess[] {
  const serviceUsers = new Set(input.serviceUsers.map((username) => username.toLowerCase()));
  return input.teams.map((team) => {
    const repositories = input.applications
      .filter((application) => application.team === team.slug)
      .map((application) => application.repositoryName);
    const group = team.group ?? input.tenantGroup;
    return {
      name: forgejoTeamName(input.baseTeam, input.tenantTeam, team.slug),
      usernames: team.group === null && repositories.length === 0
        ? []
        : input.users
          .filter((found) => found.groups.includes(input.tenantGroup) && found.groups.includes(group))
          .map((found) => found.username)
          .filter((username) => !serviceUsers.has(username.toLowerCase())),
      repositories,
    };
  });
}

export function forgejoTeamName(base: string, tenantTeam: string, team: string): string {
  return team === tenantTeam ? base : `${base}-${team}`;
}
