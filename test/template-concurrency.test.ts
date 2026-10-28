import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { buildTemplate } from "@/domain/templates/rule-group-template";
import type { RuleGroup } from "@/domain/entities";
import { withTemplateLock } from "@/server/templates/template-lock";
import type { RowDataPacket } from "mysql2/promise";
import { getPool, closePools } from "@/server/db/mysql";
import { publishTemplate, getTemplate, deleteTemplate } from "@/server/templates/team-templates";
const exec = promisify(execFile);
const group: RuleGroup = { id: "g", name: "并发测试", jql: "project = TEST", expand: "", base_paths: { json_dir: "", dbc_dir: "", proto_dir: "" }, model_to_files: {}, prompts: { EXTRACT_SIGNALS_SYSTEM: "", REQUIREMENT_EXTRACT_SYSTEM: "", LOG_SUMMARY_SYSTEM: "", ANDROID_QNX_LOG_SUMMARY_SYSTEM: "", CONSISTENCY_SYSTEM: "", COMPARE_CANTRACE: "" }, sortOrder: 0, createdAt: new Date(), updatedAt: new Date() };
const keys: string[] = [];
const alice = { username: "concurrency-alice", isAdmin: false };
function template() { const templateKey = `vitest-concurrent-${randomUUID()}`; keys.push(templateKey); return buildTemplate(group, { templateKey, version: 1, name: "并发测试", author: alice.username }); }
describe.skipIf(!process.env.MYSQL_URL)("模板真实MySQL并发", () => {
  afterEach(async () => { const pool = await getPool(); for (const key of keys.splice(0)) await pool.query("DELETE FROM team_templates WHERE template_key = ?", [key]); });
  afterAll(closePools);
  it("12个相同发布全部成功，只生成一个版本，不因池大小5而死锁", async () => {
    const input = template(); const results = await Promise.allSettled(Array.from({ length: 12 }, () => publishTemplate(input, alice)));
    expect(results.filter(result => result.status === "rejected")).toEqual([]);
    const values = results.filter(result => result.status === "fulfilled").map(result => result.value);
    expect(values.filter(result => result.created)).toHaveLength(1); expect(values.every(result => result.template.version === 1)).toBe(true);
  }, 30_000);
  it("两个独立Node进程共享门禁，同配置只创建一次", async () => {
    const input = template();
    const code = `const { publishTemplate } = require(${JSON.stringify(path.resolve("src/server/templates/team-templates.ts"))}); const { closePools } = require(${JSON.stringify(path.resolve("src/server/db/mysql.ts"))}); (async () => { try { console.log(JSON.stringify(await publishTemplate(${JSON.stringify(input)}, ${JSON.stringify(alice)}))); } finally { await closePools(); } })().catch(error => { console.error(error); process.exitCode = 1; });`;
    const results = await Promise.allSettled([0, 1].map(() => exec(process.execPath, ["--import", "tsx", "-e", code], { timeout: 20_000 })));
    expect(results.filter(result => result.status === "rejected")).toEqual([]);
    const values = results.filter(result => result.status === "fulfilled").map(result => JSON.parse(result.value.stdout)); expect(values.filter(result => result.created)).toHaveLength(1); expect(values.every(result => result.template.version === 1)).toBe(true);
  }, 30_000);
  it("并发修改配置生成连续版本，大小写同标识保持同一去重门禁", async () => {
    const input = template(); await publishTemplate(input, alice);
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => publishTemplate({ ...input, config: { ...input.config, jql: `project = TEST${index}` } }, alice)));
    expect(results.filter(result => result.status === "rejected")).toEqual([]);
    expect(results.filter(result => result.status === "fulfilled").map(result => result.value.template.version).sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, index) => index + 2));
    const other = template(); const variants = await Promise.allSettled([publishTemplate(other, alice), publishTemplate({ ...other, templateKey: other.templateKey.toUpperCase() }, alice)]);
    expect(variants.filter(result => result.status === "rejected")).toEqual([]); expect(variants.filter(result => result.status === "fulfilled" && result.value.created)).toHaveLength(1);
  }, 30_000);
  it("与MySQL排序规则等价的标识也共享同一锁，兼容旧数据与删除参数", async () => {
    const key = template().templateKey + "a"; const alias = key.slice(0, -1) + "á";
    const [rows] = await (await getPool()).query<RowDataPacket[]>("SELECT ? COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci AS sameKey", [key, alias]); expect(rows[0].sameKey).toBe(1);
    let active = 0, maxActive = 0;
    const results = await Promise.allSettled([key, alias, key.toUpperCase(), `${key} `].map(value => withTemplateLock(value, async () => { active++; maxActive = Math.max(maxActive, active); await new Promise(resolve => setTimeout(resolve, 25)); active--; })));
    expect(results.filter(result => result.status === "rejected")).toEqual([]); expect(maxActive).toBe(1);
  });
  it("不同作者抢同一新标识，只有原作者成功，另一个收到权限原因", async () => {
    const input = template(); const actors = [alice, { username: "concurrency-bob", isAdmin: false }];
    const results = await Promise.allSettled(actors.map(actor => publishTemplate(input, actor)));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1); const failures = results.filter(result => result.status === "rejected"); expect(failures).toHaveLength(1); expect(String(failures[0].reason)).toContain("模板标识已被");
    const saved = (await getTemplate(input.templateKey))!; expect(actors.map(actor => actor.username)).toContain(saved.author);
  });
  it("迁移留下不同版本删除状态时，不把旧配置误当成相同配置去重", async () => {
    const input = template(); await publishTemplate(input, alice); const changed = { ...input, config: { ...input.config, jql: "project = NEW" } }; await publishTemplate(changed, alice);
    await (await getPool()).query("UPDATE team_templates SET deleted = 1 WHERE template_key = ? AND version = 2", [input.templateKey]);
    expect(await publishTemplate(changed, alice)).toMatchObject({ created: true, template: { version: 3, config: { jql: "project = NEW" } } });
  });
  it("发布与删除串行后结果与版本一致，删除后的重新发布不复活旧版本", async () => {
    const input = template(); await publishTemplate(input, alice);
    const results = await Promise.allSettled([publishTemplate({ ...input, config: { ...input.config, jql: "project = UPDATED" } }, alice), deleteTemplate(input.templateKey, alice)]);
    expect(results.filter(result => result.status === "rejected")).toEqual([]);
    // 不依赖哪一请求先获得锁，最后再显式删除并重发核对版本保留。
    await deleteTemplate(input.templateKey, alice); const revived = await publishTemplate(input, alice); expect(revived).toMatchObject({ created: true, template: { version: 3 } }); expect(await getTemplate(input.templateKey, 1)).toBeNull();
    await expect(publishTemplate(input, { username: "unrelated", isAdmin: false })).rejects.toThrow("模板标识已被");
    expect(await publishTemplate({ ...input, config: { ...input.config, jql: "project = ADMIN" } }, { username: "admin", isAdmin: true })).toMatchObject({ template: { version: 4, author: alice.username } });
  });
});
