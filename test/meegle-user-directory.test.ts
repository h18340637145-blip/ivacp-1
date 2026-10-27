import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  buildMeegleUserSearchArgs,
  normalizeCompleteMeegleTeamMembersResponse,
  normalizeCompleteMeegleTeamsResponse,
} from "@/server/meegle/cli";
import {
  __clearMeegleUserDirectoryCache,
  buildMeegleUserDirectory,
  searchMeegleUserDirectory,
  type MeegleUserDirectoryDependencies,
} from "@/server/meegle/user-directory";
import { createGetMeegleUsersHandler } from "@/server/meegle/users";

// 逐条移植自旧 scripts/test-meegle-user-directory.ts
describe("飞书人员目录", () => {
it("CLI 团队/成员响应解析与人员搜索参数", () => {
assert.deepEqual(
  normalizeCompleteMeegleTeamsResponse({
    data: [
      { team_id: "team-a", team_name: "底盘团队" },
      { team_id: "team-b", team_name: "座舱团队" },
    ],
  }),
  [
    { teamId: "team-a", teamName: "底盘团队" },
    { teamId: "team-b", teamName: "座舱团队" },
  ],
  "team list 应解析真实 data 数组",
);
assert.deepEqual(
  normalizeCompleteMeegleTeamMembersResponse({ data: { members: ["u1", "u2"] } }),
  ["u1", "u2"],
  "team list-members 应解析 envelope data 包装",
);
assert.throws(
  () => normalizeCompleteMeegleTeamMembersResponse({ data: { items: ["u1"] } }),
  /响应格式无效/,
  "未知成员响应形状必须拒绝",
);
assert.deepEqual(
  buildMeegleUserSearchArgs(["u1", "u2"]),
  ["user", "search", "--user-keys", "u1,u2", "--need-all-status"],
  "全量人员查询必须包含 --need-all-status",
);
assert.throws(
  () => normalizeCompleteMeegleTeamsResponse({ teams: [] }),
  /响应格式无效/,
  "未知团队响应形状必须拒绝",
);
assert.throws(
  () => normalizeCompleteMeegleTeamsResponse({
    data: [{ team_id: "team-a", team_name: "底盘团队" }],
    meta: { truncated: true },
  }),
  /自动分页结果不完整/,
  "真实 envelope meta 中截断的团队响应必须拒绝",
);
assert.throws(
  () => normalizeCompleteMeegleTeamMembersResponse({
    data: { members: ["u1"] },
    meta: { truncated: true },
  }),
  /自动分页结果不完整/,
  "真实 envelope meta 中截断的成员响应必须拒绝",
);
});

function makeDependencies(overrides: Partial<MeegleUserDirectoryDependencies> = {}) {
  const memberCalls: string[] = [];
  const userBatches: string[][] = [];
  const dependencies: MeegleUserDirectoryDependencies = {
    listTeams: async () => [
      { teamId: "team-a", teamName: "底盘团队" },
      { teamId: "team-b", teamName: "座舱团队" },
    ],
    listMembers: async (_projectKey, teamId) => {
      memberCalls.push(teamId);
      return teamId === "team-a"
        ? ["u1", "u2", ...Array.from({ length: 20 }, (_, index) => `extra-${index}`)]
        : ["u1", "u3"];
    },
    resolveUsers: async (keys) => {
      userBatches.push([...keys]);
      assert.ok(keys.length <= 20, "每个用户解析批次不得超过 20");
      return keys.map((key) => ({
        key,
        name: key === "u1" ? "张伟" : key === "u2" ? "王小明" : key,
        email: `${key}@example.com`,
      }));
    },
    ...overrides,
  };
  return { dependencies, memberCalls, userBatches };
}

it("目录构建、搜索、缓存、并发合并与失败重试", async () => {
__clearMeegleUserDirectoryCache();
const fixture = makeDependencies();
const directory = await buildMeegleUserDirectory("project-a", fixture.dependencies);
assert.equal(fixture.memberCalls.length, 2, "应读取两个团队的成员");
assert.equal(fixture.userBatches.length, 2, "超过 20 个用户时应拆成多个批次");
assert.deepEqual(
  directory.find((user) => user.key === "u1")?.teamNames,
  ["底盘团队", "座舱团队"],
  "重复用户 key 应去重并聚合团队名称",
);

const chineseMatches = await searchMeegleUserDirectory("project-a", "张", fixture.dependencies);
assert.deepEqual(chineseMatches.map((user) => user.key), ["u1"], "应支持中文部分姓名搜索");
const normalizedMatches = await searchMeegleUserDirectory("project-a", "Ｕ１@", fixture.dependencies);
assert.deepEqual(normalizedMatches.map((user) => user.key), ["u1"], "搜索应使用 NFKC 归一化");

const sortedFixture = makeDependencies({
  listMembers: async () => ["b", "a", ...Array.from({ length: 60 }, (_, index) => `z${index}`)],
  resolveUsers: async (keys) => keys.map((key) => ({ key, name: key === "a" || key === "b" ? "同名" : "张三" })),
});
__clearMeegleUserDirectoryCache();
const limited = await searchMeegleUserDirectory("project-limit", "名", sortedFixture.dependencies);
assert.deepEqual(limited.map((user) => user.key), ["a", "b"], "同名用户应按 key 稳定排序");
const maxFifty = await searchMeegleUserDirectory("project-limit", "张", sortedFixture.dependencies);
assert.equal(maxFifty.length, 50, "搜索结果最多返回 50 条");

__clearMeegleUserDirectoryCache();
let cacheBuilds = 0;
const cacheFixture = makeDependencies({
  now: () => now,
  listTeams: async () => {
    cacheBuilds += 1;
    return [{ teamId: "team-cache", teamName: "缓存团队" }];
  },
  listMembers: async () => ["cache-user"],
});
let now = 0;
await buildMeegleUserDirectory("project-cache", cacheFixture.dependencies);
now = 299_999;
await buildMeegleUserDirectory("project-cache", cacheFixture.dependencies);
assert.equal(cacheBuilds, 1, "缓存创建后 299999ms 应命中");
now = 300_000;
await buildMeegleUserDirectory("project-cache", cacheFixture.dependencies);
assert.equal(cacheBuilds, 2, "缓存创建后恰好 300000ms 应重建");

__clearMeegleUserDirectoryCache();
let coalescedBuilds = 0;
let releaseCoalesced!: () => void;
const coalescedGate = new Promise<void>((resolve) => { releaseCoalesced = resolve; });
const coalescedFixture = makeDependencies({
  listTeams: async () => {
    coalescedBuilds += 1;
    await coalescedGate;
    return [{ teamId: "coalesced-team", teamName: "合并团队" }];
  },
  listMembers: async () => ["coalesced-user"],
});
const coalescedFirst = buildMeegleUserDirectory("project-coalesced", coalescedFixture.dependencies);
const coalescedSecond = buildMeegleUserDirectory("project-coalesced", coalescedFixture.dependencies);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(coalescedBuilds, 1, "同 project 冷缓存并发请求应合并为一次构建");
releaseCoalesced();
assert.strictEqual(await coalescedFirst, await coalescedSecond, "合并请求应共享同一结果引用");

__clearMeegleUserDirectoryCache();
const projectCalls: string[] = [];
let releaseProjects!: () => void;
const projectsGate = new Promise<void>((resolve) => { releaseProjects = resolve; });
const projectsFixture = makeDependencies({
  listTeams: async (projectKey) => {
    projectCalls.push(projectKey);
    await projectsGate;
    return [{ teamId: `${projectKey}-team`, teamName: projectKey }];
  },
  listMembers: async (projectKey) => [`${projectKey}-user`],
});
const projectOne = buildMeegleUserDirectory("project-one", projectsFixture.dependencies);
const projectTwo = buildMeegleUserDirectory("project-two", projectsFixture.dependencies);
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(projectCalls.sort(), ["project-one", "project-two"], "不同 project 的构建必须隔离");
releaseProjects();
await Promise.all([projectOne, projectTwo]);

__clearMeegleUserDirectoryCache();
let inFlightFailureAttempts = 0;
const inFlightFailure = makeDependencies({
  listTeams: async () => {
    inFlightFailureAttempts += 1;
    if (inFlightFailureAttempts === 1) throw new Error("in-flight failure");
    return [{ teamId: "retry-team", teamName: "重试团队" }];
  },
  listMembers: async () => ["retry-user"],
});
const failedBuilds = await Promise.allSettled([
  buildMeegleUserDirectory("project-inflight-failure", inFlightFailure.dependencies),
  buildMeegleUserDirectory("project-inflight-failure", inFlightFailure.dependencies),
]);
assert.equal(failedBuilds.every((result) => result.status === "rejected"), true);
assert.equal(inFlightFailureAttempts, 1, "同 project 的失败请求也应合并");
await buildMeegleUserDirectory("project-inflight-failure", inFlightFailure.dependencies);
assert.equal(inFlightFailureAttempts, 2, "失败后必须清除 in-flight 并允许重试");

__clearMeegleUserDirectoryCache();
let teamAttempts = 0;
const teamFailure = makeDependencies({
  listMembers: async () => {
    teamAttempts += 1;
    if (teamAttempts === 1) throw new Error("CLI secret team failure");
    return ["u1"];
  },
});
await assert.rejects(buildMeegleUserDirectory("project-team-failure", teamFailure.dependencies), /team failure/);
await buildMeegleUserDirectory("project-team-failure", teamFailure.dependencies);
assert.ok(teamAttempts >= 2, "团队失败不能进入缓存，下一次必须重试");

__clearMeegleUserDirectoryCache();
let userAttempts = 0;
const userFailure = makeDependencies({
  resolveUsers: async (keys) => {
    userAttempts += 1;
    if (userAttempts === 1) throw new Error("CLI secret user failure");
    return keys.map((key) => ({ key, name: key }));
  },
});
await assert.rejects(buildMeegleUserDirectory("project-user-failure", userFailure.dependencies), /user failure/);
await buildMeegleUserDirectory("project-user-failure", userFailure.dependencies);
assert.ok(userAttempts >= 2, "用户批次失败不能进入缓存，下一次必须重试");

async function assertIncompleteUsersRejected(
  projectKey: string,
  firstResult: (keys: string[]) => unknown,
) {
  __clearMeegleUserDirectoryCache();
  let attempts = 0;
  const fixture = makeDependencies({
    listTeams: async () => [{ teamId: "strict-team", teamName: "严格团队" }],
    listMembers: async () => ["strict-u1", "strict-u2"],
    resolveUsers: async (keys) => {
      attempts += 1;
      if (attempts === 1) return firstResult(keys) as Awaited<ReturnType<MeegleUserDirectoryDependencies["resolveUsers"]>>;
      return keys.map((key) => ({ key, name: key }));
    },
  });
  await assert.rejects(buildMeegleUserDirectory(projectKey, fixture.dependencies), /用户批次响应不完整/);
  await buildMeegleUserDirectory(projectKey, fixture.dependencies);
  assert.equal(attempts, 2, `${projectKey} 的失败构建不得缓存`);
}

await assertIncompleteUsersRejected("project-empty-users", () => []);
await assertIncompleteUsersRejected("project-missing-user", (keys) => [{ key: keys[0], name: keys[0] }]);
await assertIncompleteUsersRejected("project-malformed-user", (keys) => [
  { key: keys[0], name: keys[0] },
  { name: "缺少 key" },
]);
await assertIncompleteUsersRejected("project-extra-user", (keys) => [
  ...keys.map((key) => ({ key, name: key })),
  { key: "unexpected", name: "额外用户" },
]);
await assertIncompleteUsersRejected("project-duplicate-user", (keys) => [
  ...keys.map((key) => ({ key, name: key })),
  { key: keys[0], name: "冲突数据" },
]);
await assertIncompleteUsersRejected("project-identical-duplicate-user", (keys) => [
  ...keys.map((key) => ({ key, name: key })),
  { key: keys[0], name: keys[0] },
]);

let activeMembers = 0;
let maxActiveMembers = 0;
let releaseMembers!: () => void;
const membersGate = new Promise<void>((resolve) => { releaseMembers = resolve; });
let sixStarted!: () => void;
const sixMembersStarted = new Promise<void>((resolve) => { sixStarted = resolve; });
const concurrencyFixture = makeDependencies({
  listTeams: async () => Array.from({ length: 9 }, (_, index) => ({
    teamId: `team-${index}`,
    teamName: `团队 ${index}`,
  })),
  listMembers: async () => {
    activeMembers += 1;
    maxActiveMembers = Math.max(maxActiveMembers, activeMembers);
    if (activeMembers === 6) sixStarted();
    await membersGate;
    activeMembers -= 1;
    return [];
  },
});
__clearMeegleUserDirectoryCache();
const concurrencyBuild = buildMeegleUserDirectory("project-concurrency", concurrencyFixture.dependencies);
await Promise.race([
  sixMembersStarted,
  new Promise((_, reject) => setTimeout(() => reject(new Error("未启动 6 个并发团队任务")), 100)),
]);
assert.equal(maxActiveMembers, 6, "团队成员查询应恰好使用 6 个并发 worker");
releaseMembers();
await concurrencyBuild;

let activeUserBatches = 0;
let maxActiveUserBatches = 0;
let releaseUserBatches!: () => void;
const userBatchGate = new Promise<void>((resolve) => { releaseUserBatches = resolve; });
let fourUserBatchesStarted!: () => void;
const fourBatchesStarted = new Promise<void>((resolve) => { fourUserBatchesStarted = resolve; });
const userBatchFixture = makeDependencies({
  listTeams: async () => [{ teamId: "batch-team", teamName: "批次团队" }],
  listMembers: async () => Array.from({ length: 100 }, (_, index) => `batch-${index}`),
  resolveUsers: async (keys) => {
    activeUserBatches += 1;
    maxActiveUserBatches = Math.max(maxActiveUserBatches, activeUserBatches);
    if (activeUserBatches === 4) fourUserBatchesStarted();
    await userBatchGate;
    activeUserBatches -= 1;
    return keys.map((key) => ({ key, name: key }));
  },
});
__clearMeegleUserDirectoryCache();
const userBatchBuild = buildMeegleUserDirectory("project-user-batch-concurrency", userBatchFixture.dependencies);
await Promise.race([
  fourBatchesStarted,
  new Promise((_, reject) => setTimeout(() => reject(new Error("未启动 4 个并发用户批次")), 100)),
]);
assert.equal(maxActiveUserBatches, 4, "用户批次查询应恰好使用 4 个并发 worker");
releaseUserBatches();
await userBatchBuild;

const handler = createGetMeegleUsersHandler(async () => [{ key: "u1", name: "张伟", teamNames: ["底盘团队"] }]);
const okResponse = await handler(new Request("http://localhost/api/meegle/users?projectKey=p&q=%E5%BC%A0"));
assert.equal(okResponse.status, 200);
assert.deepEqual(await okResponse.json(), {
  users: [{ key: "u1", name: "张伟", teamNames: ["底盘团队"] }],
  complete: true,
});
for (const url of [
  "http://localhost/api/meegle/users?q=x",
  "http://localhost/api/meegle/users?projectKey=p&q=%20",
]) {
  const response = await handler(new Request(url));
  assert.equal(response.status, 400, "projectKey 和非空 q 均为必填");
  assert.doesNotMatch(JSON.stringify(await response.json()), /CLI|secret/i, "400 响应不得泄露内部信息");
}
const failedHandler = createGetMeegleUsersHandler(async () => {
  throw new Error("CLI secret failure");
});
const failedResponse = await failedHandler(new Request("http://localhost/api/meegle/users?projectKey=p&q=x"));
assert.equal(failedResponse.status, 502);
assert.deepEqual(await failedResponse.json(), { error: "获取飞书人员目录失败" }, "502 应返回安全中文错误");

});
});
