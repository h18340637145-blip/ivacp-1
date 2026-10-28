import { describe, expect, it } from "vitest";
import { parseTemplate, templateToRuleGroupInput } from "@/domain/templates/rule-group-template";
const template = (files: unknown) => ({ kind: "rule-group-template", schemaVersion: 1, templateKey: "sample", name: "样例", config: { jql: "project = A", model_to_files: files } });
describe("模板车型配置边界", () => {
  it.each([null, 42, [], { D01: null }, { D01: { dbc: 42 } }, { D01: { json: {} } }, { D01: { proto: [] } }])("拒绝损坏的车型配置 %#", files => {
    expect(() => parseTemplate(template(files))).toThrow(/车型文件/);
  });
  it("旧文件格式规范化后再应用，字符串DBC与JSON数组可编辑", () => {
    const parsed = parseTemplate(template({ D01: { json: ["a.json", "b.json"], dbc: "a.dbc, b.dbc", proto: "m.proto" } }));
    expect(templateToRuleGroupInput(parsed).model_to_files).toEqual({ D01: { json: "a.json, b.json", dbc: ["a.dbc", "b.dbc"], proto: "m.proto" } });
  });
});
