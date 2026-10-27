import { describe, expect, it } from "vitest";
import { parseRuleGroupImport } from "@/domain/rule-groups/import";

const group = {
  id: "rg1", name: "测试规则", jql: "project = TEST", expand: "",
  base_paths: { json_dir: "/json", dbc_dir: "/dbc", proto_dir: "" },
  model_to_files: { D01: { json: "signals.json", dbc: ["body.dbc"], proto: "" } },
  prompts: { CONSISTENCY_SYSTEM: "按证据分析" },
  sortOrder: 5, createdAt: "2026-01-01T00:00:00.000Z",
};

describe("规则组文件导入边界", () => {
  it("还原旧导出文件日期并补齐可选配置", () => {
    const [row] = parseRuleGroupImport({ version: "1.0", ruleGroups: [group] });
    expect(row.createdAt).toEqual(new Date(group.createdAt));
    expect(row.prompts.CONSISTENCY_SYSTEM).toBe("按证据分析");
    expect(row.prompts.EXTRACT_SIGNALS_SYSTEM).toBe("");
    expect(row.model_to_files.D01.dbc).toEqual(["body.dbc"]);
    expect(row.sortOrder).toBe(5);
  });

  it("兼容旧车型文件中 json 数组和逗号分隔的 DBC", () => {
    const [row] = parseRuleGroupImport({ ruleGroups: [{ ...group,
      model_to_files: { D01: { json: ["a.json", "b.json"], dbc: "a.dbc, b.dbc" } },
    }] });
    expect(row.model_to_files.D01).toEqual({ json: "a.json, b.json", dbc: ["a.dbc", "b.dbc"], proto: "" });
  });

  it.each([
    null, {}, { ruleGroups: [null] }, { ruleGroups: [{ ...group, id: "" }] },
    { ruleGroups: [{ ...group, name: " " }] },
    { ruleGroups: [{ ...group, createdAt: "bad date" }] },
    { ruleGroups: [group, group] },
    { version: "99.0", ruleGroups: [group] },
    { ruleGroups: [{ ...group, base_paths: "bad" }] },
    { ruleGroups: [{ ...group, jiraProvider: "unknown" }] },
  ])("拒绝无效文件，防止覆盖导入破坏原数据：%j", (input) => {
    expect(() => parseRuleGroupImport(input)).toThrow();
  });

  it("允许空列表文件，由界面确认覆盖意图", () => {
    expect(parseRuleGroupImport({ version: "1.0", ruleGroups: [] })).toEqual([]);
  });
});
