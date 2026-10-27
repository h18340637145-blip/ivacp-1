import { describe, expect, it } from "vitest";
import {
  decideMeegleAssignment,
  normalizeMeegleClassification,
  shouldApplyAutoAssignment,
} from "@/server/meegle/filtering";

const groups = [
  { id: "chery-t1j-8255", name: "chery T1J_FL3-8255", model_to_files: { T1J_FL3: {} } },
  { id: "geely-d01-8155", name: "geely D01-8155", model_to_files: { D01: {} } },
];

describe("飞书模型分类自动分配", () => {
  it("归一化车型、项目别名与平台", () => {
    expect(normalizeMeegleClassification({ carModel: "T1J-FL3", project: "奇瑞", platform: "8255" }))
      .toEqual({ carModel: "t1jfl3", project: "chery", platform: "8255" });
  });

  it("按车型配置 / 项目+平台匹配规则组", () => {
    expect(decideMeegleAssignment({ carModel: "T1J-FL3", project: "奇瑞", platform: "8255" }, groups).ruleGroupId).toBe("chery-t1j-8255");
    expect(decideMeegleAssignment({ carModel: "", project: "chery", platform: "" }, groups).decision).toBe("unassigned");
    expect(decideMeegleAssignment({ carModel: "", project: "geely", platform: "8155" }, groups).ruleGroupId).toBe("geely-d01-8155");
  });

  it("人工分配不被自动分配覆盖", () => {
    expect(shouldApplyAutoAssignment({ assignmentSource: "manual", ruleGroupId: "manual-group" })).toBe(false);
    expect(shouldApplyAutoAssignment({ assignmentSource: "auto", ruleGroupId: "old-group" })).toBe(true);
  });
});
