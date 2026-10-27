import {
  assertCompleteMeegleUserBatch,
  chunkMeegleUserKeys,
  listMeegleTeamMembers,
  listMeegleTeams,
  resolveMeegleUsers,
  type MeegleTeam,
  type MeegleUser,
} from "@/server/meegle/cli";

const CACHE_TTL_MS = 5 * 60 * 1_000;
const TEAM_MEMBER_CONCURRENCY = 6;
const USER_BATCH_CONCURRENCY = 4;
const SEARCH_RESULT_LIMIT = 50;
const SEARCH_LOCALE = "zh-CN";
const searchCollator = new Intl.Collator(SEARCH_LOCALE);

export interface MeegleDirectoryUser extends MeegleUser {
  teamNames: string[];
}

export interface MeegleUserDirectoryDependencies {
  listTeams: (projectKey: string) => Promise<MeegleTeam[]>;
  listMembers: (projectKey: string, teamId: string) => Promise<string[]>;
  resolveUsers: (userKeys: string[]) => Promise<MeegleUser[]>;
  now?: () => number;
}

interface CachedDirectory {
  expiresAt: number;
  users: MeegleDirectoryUser[];
}

const directoryCache = new Map<string, CachedDirectory>();
const directoryBuilds = new Map<string, Promise<MeegleDirectoryUser[]>>();

const defaultDependencies: MeegleUserDirectoryDependencies = {
  listTeams: listMeegleTeams,
  listMembers: listMeegleTeamMembers,
  resolveUsers: resolveMeegleUsers,
};

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  let firstError: unknown;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await operation(values[index]);
      } catch (error) {
        firstError ??= error;
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    () => worker(),
  ));
  if (firstError !== undefined) throw firstError;
  return results;
}

export function __clearMeegleUserDirectoryCache(): void {
  directoryCache.clear();
  directoryBuilds.clear();
}

async function buildUncachedMeegleUserDirectory(
  projectKey: string,
  dependencies: MeegleUserDirectoryDependencies,
): Promise<MeegleDirectoryUser[]> {
  const teams = await dependencies.listTeams(projectKey);
  const memberLists = await mapWithConcurrency(
    teams,
    TEAM_MEMBER_CONCURRENCY,
    (team) => dependencies.listMembers(projectKey, team.teamId),
  );
  const teamNamesByUserKey = new Map<string, Set<string>>();
  teams.forEach((team, index) => {
    for (const userKey of memberLists[index]) {
      const names = teamNamesByUserKey.get(userKey) ?? new Set<string>();
      names.add(team.teamName);
      teamNamesByUserKey.set(userKey, names);
    }
  });

  const batches = chunkMeegleUserKeys([...teamNamesByUserKey.keys()]);
  const resolvedBatches = await mapWithConcurrency(
    batches,
    USER_BATCH_CONCURRENCY,
    (batch) => dependencies.resolveUsers(batch),
  );
  const usersByKey = new Map<string, MeegleUser>();
  for (const [index, users] of resolvedBatches.entries()) {
    assertCompleteMeegleUserBatch(batches[index], users);
    for (const user of users) usersByKey.set(user.key, user);
  }
  const users = [...usersByKey.values()].map((user) => ({
    ...user,
    teamNames: [...(teamNamesByUserKey.get(user.key) ?? [])],
  }));
  const completedAt = dependencies.now?.() ?? Date.now();
  directoryCache.set(projectKey, { expiresAt: completedAt + CACHE_TTL_MS, users });
  return users;
}

export async function buildMeegleUserDirectory(
  projectKey: string,
  dependencies: MeegleUserDirectoryDependencies = defaultDependencies,
): Promise<MeegleDirectoryUser[]> {
  const now = dependencies.now?.() ?? Date.now();
  const cached = directoryCache.get(projectKey);
  if (cached && cached.expiresAt > now) return cached.users;
  if (cached) directoryCache.delete(projectKey);

  const activeBuild = directoryBuilds.get(projectKey);
  if (activeBuild) return activeBuild;
  const build = buildUncachedMeegleUserDirectory(projectKey, dependencies);
  directoryBuilds.set(projectKey, build);
  try {
    return await build;
  } finally {
    if (directoryBuilds.get(projectKey) === build) directoryBuilds.delete(projectKey);
  }
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase(SEARCH_LOCALE);
}

export async function searchMeegleUserDirectory(
  projectKey: string,
  query: string,
  dependencies: MeegleUserDirectoryDependencies = defaultDependencies,
): Promise<MeegleDirectoryUser[]> {
  const normalizedQuery = normalizeSearchText(query);
  const users = await buildMeegleUserDirectory(projectKey, dependencies);
  return users
    .filter((user) => normalizeSearchText(user.name).includes(normalizedQuery)
      || normalizeSearchText(user.email ?? "").includes(normalizedQuery))
    .sort((left, right) => searchCollator.compare(left.name, right.name)
      || searchCollator.compare(left.key, right.key))
    .slice(0, SEARCH_RESULT_LIMIT);
}
