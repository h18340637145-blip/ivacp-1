import { describe, expect, it } from "vitest";
import { emptyRuleGroupForm, formToRuleGroupInput, ruleGroupToForm, validateRuleGroupForm } from "@/domain/rule-groups/form";
import { parseModelFiles } from "@/domain/rule-groups/model-files";
import { parseRuleGroupImport } from "@/domain/rule-groups/import";
import { buildTemplate, parseTemplate, templateToRuleGroupInput } from "@/domain/templates/rule-group-template";
import { processRequestSchema } from "@/server/pipeline/process/request";

const aliases = ["T1JFL3", "t1jfl3", "T1J_FL3"];
const files = { "T1J-FL3-8255": { json: "a.json", dbc: ["a.dbc", "b.dbc"], proto: "a.proto", aliases } };
const request = { issueKey: "TEST-1", summary: "", rawData: {}, prompts: {}, ruleGroupId: "g", modelToFiles: files };
const group = () => parseRuleGroupImport({ ruleGroups: [{ id: "g", name: "测试", jql: "project = TEST", model_to_files: files }] })[0];

describe("规则组车型别名配置链路", () => {
  it("表单多值分隔、修剪和同车型去重后保留大小写差异", () => {
    const form = emptyRuleGroupForm();
    form.name = "测试";
    form.modelRows = [{ rowId: "1", modelName: "M", json: "", dbc: "", proto: "", ...{ aliases: " T1JFL3，t1jfl3;T1J_FL3；T1JFL3\n T1J_FL3 " } }];
    expect(formToRuleGroupInput(form, false).model_to_files.M).toMatchObject({ aliases });
  });

  it("编辑已配置车型时显示别名且保存不丢失", () => {
    const form = ruleGroupToForm(group(), () => "row");
    expect(form.modelRows[0]).toMatchObject({ aliases: aliases.join(", ") });
    expect(formToRuleGroupInput(form, false).model_to_files).toEqual(files);
  });

  it("允许跨车型重复别名以保留用户配置", () => {
    const form = emptyRuleGroupForm();
    form.name = "测试";
    form.modelRows = ["M", "N"].map(modelName => ({ rowId: modelName, modelName, json: "", dbc: "", proto: "", aliases: "T1JFL3" }));
    expect(validateRuleGroupForm(form)).toEqual({});
    expect(Object.values(formToRuleGroupInput(form, false).model_to_files)).toEqual([
      { json: "", dbc: [], proto: "", aliases: ["T1JFL3"] }, { json: "", dbc: [], proto: "", aliases: ["T1JFL3"] },
    ]);
  });

  it("备份导入和模板导出再应用均保留别名", () => {
    expect(parseModelFiles(files)).toEqual(files);
    const imported = group();
    expect(imported.model_to_files).toEqual(files);
    const template = buildTemplate(imported, { templateKey: "sample", version: 1, name: "样例", author: "tester" });
    const parsed = parseTemplate(JSON.parse(JSON.stringify(template)));
    expect(templateToRuleGroupInput(parsed).model_to_files).toEqual(files);
    expect(parsed.checksum).toBe(template.checksum);
  });

  it("Jira 与飞书 process 请求解析后均保留别名", () => {
    expect(processRequestSchema.parse(request).modelToFiles).toEqual(files);
    expect(processRequestSchema.parse({ ...request, issueKey: "meegle-1", source: "meegle", rawData: { projectKey: "p", workItemId: "1" } }).modelToFiles).toEqual(files);
  });

  it.each(["T1JFL3", ["T1JFL3", 1], null])("拒绝损坏的别名配置 %#", aliases => {
    const invalidFiles = { M: { json: "", dbc: [], proto: "", aliases } };
    expect(() => parseModelFiles(invalidFiles)).toThrow();
    expect(processRequestSchema.safeParse({ ...request, modelToFiles: invalidFiles }).success).toBe(false);
  });

  it("旧记录没有别名时不从车型键补出别名", () => {
    const legacy = { M: { json: "", dbc: [], proto: "" } };
    expect(parseModelFiles(legacy)).toEqual(legacy);
    const form = emptyRuleGroupForm();
    form.modelRows = [{ rowId: "1", modelName: "M", json: "", dbc: "", proto: "" }];
    expect(formToRuleGroupInput(form, false).model_to_files).toEqual(legacy);
  });
});
