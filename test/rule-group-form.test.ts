import { describe, expect, it } from "vitest";
import type { RuleGroup } from "@/domain/entities";
import {
  RULE_GROUP_PROMPT_KEYS,
  emptyRuleGroupForm,
  filledPromptCount,
  formToRuleGroupInput,
  ruleGroupToForm,
  validateRuleGroupForm,
} from "@/domain/rule-groups/form";

let counter = 0;
const rowId = () => `row-${++counter}`;

describe("rule group form", () => {
  it("round-trips a rule group", () => {
    const group = {
      id: "g1",
      name: "奇瑞",
      jql: "project = A",
      meegleMql: "mql",
      expand: "names",
      base_paths: { json_dir: "/j", dbc_dir: "/d", proto_dir: "/p" },
      model_to_files: { T1L: { json: "a.json", dbc: ["a.dbc", "b.dbc"], proto: "x.proto" } },
      prompts: { EXTRACT_SIGNALS_SYSTEM: "p1" },
      sortOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as RuleGroup;
    const form = ruleGroupToForm(group, rowId);
    expect(form.modelRows[0]).toMatchObject({ modelName: "T1L", dbc: "a.dbc, b.dbc" });
    expect(form.prompts.COMPARE_CANTRACE).toBe("");
    const output = formToRuleGroupInput(form, false);
    expect(output.model_to_files.T1L.dbc).toEqual(["a.dbc", "b.dbc"]);
    expect(output.meegleMql).toBe("mql");
    expect(output.jiraProvider).toBeUndefined();
    expect(filledPromptCount(output.prompts)).toBe(1);
    expect(Object.keys(output.prompts)).toEqual([...RULE_GROUP_PROMPT_KEYS]);
  });

  it("handles bosch and empty rows", () => {
    const form = emptyRuleGroupForm();
    form.name = "  Bosch ";
    form.meegleMql = "ignored";
    form.modelRows = [
      { rowId: "1", modelName: " ", json: "", dbc: "", proto: "" },
      { rowId: "2", modelName: "M", json: "", dbc: " , x.dbc ,", proto: "" },
    ];
    const output = formToRuleGroupInput(form, true);
    expect(output.name).toBe("Bosch");
    expect(output.jiraProvider).toBe("bosch");
    expect(output.meegleMql).toBeUndefined();
    expect(Object.keys(output.model_to_files)).toEqual(["M"]);
    expect(output.model_to_files.M.dbc).toEqual(["x.dbc"]);
  });

  it("validates name and duplicate models", () => {
    const form = emptyRuleGroupForm();
    form.modelRows = [
      { rowId: "1", modelName: "A", json: "", dbc: "", proto: "" },
      { rowId: "2", modelName: "A", json: "", dbc: "", proto: "" },
    ];
    const errors = validateRuleGroupForm(form);
    expect(errors.name).toBeTruthy();
    expect(errors.models).toContain("A");
  });
});
