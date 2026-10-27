import { describe, expect, it } from "vitest";
import type { RuleGroup } from "@/domain/entities";
import {
  buildTemplate,
  configChecksum,
  parseTemplate,
  slugifyTemplateKey,
  templateToRuleGroupInput,
} from "@/domain/templates/rule-group-template";
import { buildStatisticsReport } from "@/domain/analysis/weekly-report";
import { calculateAnnualStatistics } from "@/domain/analysis/annual-statistics";
import { canDeleteTemplate, filterTemplates, parseTagInput } from "@/domain/templates/summary";

const group: RuleGroup = {
  id: "g1",
  name: "吉利 CAN 一致性",
  jql: "project = CHER AND status = Open",
  meegleMql: "",
  expand: "changelog",
  base_paths: { json_dir: "/data/json", dbc_dir: "/data/dbc", proto_dir: "/data/proto" },
  model_to_files: { SX11: { json: "a.json", dbc: ["a.dbc"], proto: "a.proto" } },
  prompts: {
    EXTRACT_SIGNALS_SYSTEM: "提取信号",
    REQUIREMENT_EXTRACT_SYSTEM: "",
    LOG_SUMMARY_SYSTEM: "",
    ANDROID_QNX_LOG_SUMMARY_SYSTEM: "",
    CONSISTENCY_SYSTEM: "",
    COMPARE_CANTRACE: "",
  },
  sortOrder: 3,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-02"),
};

const meta = { templateKey: "geely-can", version: 2, name: "吉利模板", tags: ["吉利", "吉利", " CAN "], author: "alice" };

describe("规则组模板", () => {
  it("导出后再解析是无损往返，且不带机器相关标识", () => {
    const template = buildTemplate(group, meta, new Date("2026-02-01T00:00:00Z"));
    expect(template).not.toHaveProperty("config.id");
    expect(template).not.toHaveProperty("config.sortOrder");
    expect(template.tags).toEqual(["吉利", "CAN"]);
    const parsed = parseTemplate(JSON.parse(JSON.stringify(template)));
    expect(parsed).toEqual(template);
  });

  it("应用模板得到的规则组输入带版本名，并保留 JQL、提示词与路径", () => {
    const input = templateToRuleGroupInput(buildTemplate(group, meta));
    expect(input.name).toBe("吉利模板（模板 v2）");
    expect(input.jql).toBe(group.jql);
    expect(input.prompts.EXTRACT_SIGNALS_SYSTEM).toBe("提取信号");
    expect(input.base_paths.dbc_dir).toBe("/data/dbc");
    expect(input.model_to_files.SX11.dbc).toEqual(["a.dbc"]);
  });

  it("校验和只受配置影响，与键顺序和说明无关", () => {
    const a = buildTemplate(group, meta).config;
    const reordered = { ...a, prompts: { ...a.prompts } };
    expect(configChecksum(reordered)).toBe(configChecksum(a));
    expect(configChecksum({ ...a, jql: "project = X" })).not.toBe(configChecksum(a));
  });

  it.each([
    [null, "不是有效的规则组模板文件"],
    [{ kind: "other" }, "不是有效的规则组模板文件"],
    [{ kind: "rule-group-template", schemaVersion: 99, name: "x", config: {} }, "不支持的模板格式版本"],
    [{ kind: "rule-group-template", schemaVersion: 1, name: " ", config: {} }, "模板名称不能为空"],
    [{ kind: "rule-group-template", schemaVersion: 1, name: "x", config: { jql: "" } }, "必须包含 JQL 或飞书 MQL"],
    [{ kind: "rule-group-template", schemaVersion: 1, name: "x", templateKey: "a/b", config: { jql: "a" } }, "模板标识只允许"],
    [{ kind: "rule-group-template", schemaVersion: 1, name: "x", version: 0, config: { jql: "a" } }, "版本必须是正整数"],
  ])("拒绝无效模板 %#", (input, message) => {
    expect(() => parseTemplate(input)).toThrow(message);
  });

  it("缺少 templateKey 时由名称生成，缺失的提示词补空串", () => {
    const parsed = parseTemplate({ kind: "rule-group-template", schemaVersion: 1, name: "My Tpl 1", config: { meegleMql: "select 1" } });
    expect(parsed.templateKey).toBe("my-tpl-1");
    expect(parsed.version).toBe(1);
    expect(parsed.config.prompts.COMPARE_CANTRACE).toBe("");
    expect(slugifyTemplateKey("！！！")).toBe("template");
  });
});

describe("模板库列表辅助", () => {
  const items = [
    { templateKey: "geely-can", name: "吉利模板", author: "alice", description: "CAN 一致性", tags: ["吉利", "CAN"] },
    { templateKey: "byd", name: "比亚迪", author: "bob", description: "", tags: ["飞书"] },
  ];

  it("按名称 / 作者 / 说明 / 标签搜索，大小写不敏感", () => {
    expect(filterTemplates(items, "").length).toBe(2);
    expect(filterTemplates(items, "can").map((t) => t.templateKey)).toEqual(["geely-can"]);
    expect(filterTemplates(items, "BOB").map((t) => t.templateKey)).toEqual(["byd"]);
    expect(filterTemplates(items, "飞书").map((t) => t.templateKey)).toEqual(["byd"]);
  });

  it("标签输入按中英文逗号与空白拆分；删除权限为作者或管理员", () => {
    expect(parseTagInput(" 吉利，CAN, 台架  实车 ")).toEqual(["吉利", "CAN", "台架", "实车"]);
    expect(canDeleteTemplate({ author: "alice" }, { username: "alice", isAdmin: false })).toBe(true);
    expect(canDeleteTemplate({ author: "alice" }, { username: "bob", isAdmin: false })).toBe(false);
    expect(canDeleteTemplate({ author: "alice" }, { username: "root", isAdmin: true })).toBe(true);
  });
});

describe("统计报告", () => {
  it("生成含来源表与成员明细的 Markdown", () => {
    const total = calculateAnnualStatistics(
      [
        { source: "jira", resultId: "r1", ticketKey: "A-1", processedAt: "2026-03-05T00:00:00Z", reviewStatus: "approved" },
        { source: "meegle", resultId: "r2", ticketKey: "M-1", processedAt: "2026-03-06T00:00:00Z", reviewStatus: "rejected", manualReviewed: true },
      ],
      new Date("2026-04-01T00:00:00Z"),
      { year: 2026, startMonth: 1, endMonth: 12 },
    );
    const markdown = buildStatisticsReport({ title: "团队工单分析统计", total, members: [{ owner: "alice", statistics: total }] });
    expect(markdown).toContain("# 团队工单分析统计（2026 年 全年）");
    expect(markdown).toContain("| Jira | 1 |");
    expect(markdown).toContain("## 成员明细");
    expect(markdown).toContain("| alice | 2 |");
    expect(buildStatisticsReport({ title: "x", total })).not.toContain("成员明细");
  });
});

describe.skipIf(!process.env.MYSQL_URL)("团队模板库 MySQL", () => {
  it("发布、版本递增、去重、权限、应用计数与删除", async () => {
    const { publishTemplate, getTemplate, listTemplates, markTemplateApplied, deleteTemplate } = await import("@/server/templates/team-templates");
    const { getPool, closePools } = await import("@/server/db/mysql");
    const key = `vitest-${Date.now()}`;
    const alice = { username: "alice", isAdmin: false };
    const bob = { username: "bob", isAdmin: false };
    const admin = { username: "admin", isAdmin: true };
    const base = { ...buildTemplate(group, { ...meta, templateKey: key, version: 1 }) };
    try {
      const v1 = await publishTemplate(base, alice);
      expect(v1).toMatchObject({ created: true, template: { version: 1, author: "alice" } });

      const same = await publishTemplate(base, alice);
      expect(same).toMatchObject({ created: false, template: { version: 1 } });

      await expect(publishTemplate(base, bob)).rejects.toThrow("已被 alice 使用");

      const changed = { ...base, config: { ...base.config, jql: "project = NEW" } };
      const v2 = await publishTemplate(changed, admin);
      expect(v2).toMatchObject({ created: true, template: { version: 2, author: "alice" } });

      expect(await markTemplateApplied(key, 2)).toBe(true);
      expect(await markTemplateApplied(key, 9)).toBe(false);
      const listed = (await listTemplates()).find((item) => item.templateKey === key);
      expect(listed).toMatchObject({ version: 2, versionCount: 2, applyCount: 1 });
      expect((await getTemplate(key, 1))?.config.jql).toBe(group.jql);
      expect((await getTemplate(key))?.config.jql).toBe("project = NEW");

      expect(await deleteTemplate(key, bob)).toBe("forbidden");
      expect(await deleteTemplate(key, alice)).toBe("deleted");
      expect(await getTemplate(key)).toBeNull();
      expect(await deleteTemplate(key, alice)).toBe("not_found");
    } finally {
      const pool = await getPool();
      await pool.query("DELETE FROM team_templates WHERE template_key = ?", [key]);
      await closePools();
    }
  });
});
