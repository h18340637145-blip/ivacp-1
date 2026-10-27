import { describe, expect, it } from "vitest";
import { buildAssigneeRoleOperate, normalizeAssigneeUserKeys } from "@/domain/meegle/assignee";
import {
  assigneeWriteClaims,
  commentWriteClaims,
  createMeegleDetailReceipt,
  createMeegleWriteAuthorization,
  verifyMeegleDetailReceipt,
  verifyMeegleWriteAuthorization,
} from "@/server/meegle/write-authorization";

const detailClaims = {
  projectKey: "p",
  workItemTypeKey: "issue" as const,
  workItemId: "7",
  assigneeRoleKey: "role_x",
  assigneeUserKeys: ["u1", "u2"],
  updatedAt: "v1",
};

describe("飞书经办人写授权", () => {
  const detailReceipt = createMeegleDetailReceipt({ ...detailClaims, assigneeUserKeys: ["u2", "u1", "u1"] });

  it("详情凭据对经办人顺序/重复不敏感，但校验 updatedAt", () => {
    expect(() => verifyMeegleDetailReceipt(detailReceipt, detailClaims)).not.toThrow();
    expect(() => verifyMeegleDetailReceipt(detailReceipt, { ...detailClaims, updatedAt: "v2" })).toThrow();
  });

  it("写授权与提交内容逐项绑定", () => {
    const claims = {
      action: "assignee" as const,
      projectKey: "p",
      workItemTypeKey: "issue" as const,
      workItemId: "7",
      expectedCurrentUserKeys: ["u1", "u2"],
      targetUserKey: "u3",
      detailReceipt,
    };
    const authorization = createMeegleWriteAuthorization(claims);
    expect(() => verifyMeegleWriteAuthorization(authorization, claims)).not.toThrow();
    expect(() => verifyMeegleWriteAuthorization(authorization, { ...claims, targetUserKey: "u4" })).toThrow();
    expect(() => verifyMeegleWriteAuthorization(authorization, { ...claims, expectedCurrentUserKeys: ["u1"] })).toThrow();
    expect(() => verifyMeegleWriteAuthorization(authorization, { ...claims, workItemId: "8" })).toThrow();
  });

  it("规范化声明与字段传入顺序无关", () => {
    const authorization = createMeegleWriteAuthorization(assigneeWriteClaims({
      targetUserKey: "u3", detailReceipt, workItemId: "7", projectKey: "p", expectedCurrentUserKeys: ["u2", "u1"],
    }));
    expect(() => verifyMeegleWriteAuthorization(authorization, assigneeWriteClaims({
      projectKey: "p", workItemId: "7", expectedCurrentUserKeys: ["u1", "u2"], targetUserKey: "u3", detailReceipt,
    }))).not.toThrow();

    const comment = createMeegleWriteAuthorization(commentWriteClaims({
      analysisReceipt: "r", body: "结论", resultId: "res", workItemId: "7", projectKey: "p",
    }));
    expect(() => verifyMeegleWriteAuthorization(comment, commentWriteClaims({
      projectKey: "p", workItemId: "7", resultId: "res", body: "结论", analysisReceipt: "r",
    }))).not.toThrow();
    expect(() => verifyMeegleWriteAuthorization(comment, commentWriteClaims({
      projectKey: "p", workItemId: "7", resultId: "res", body: "篡改", analysisReceipt: "r",
    }))).toThrow("飞书写操作授权与提交内容不匹配");
  });
});

describe("经办人角色变更", () => {
  it("去重、去空并排序", () => {
    expect(normalizeAssigneeUserKeys(["u2", "u1", "u2", " "])).toEqual(["u1", "u2"]);
  });

  it("先移除当前经办人再添加目标；已是目标时无需变更", () => {
    expect(buildAssigneeRoleOperate("role_x", ["u2", "u1"], "u3")).toEqual([
      { op: "remove", role_key: "role_x", user_keys: ["u1", "u2"] },
      { op: "add", role_key: "role_x", user_keys: ["u3"] },
    ]);
    expect(buildAssigneeRoleOperate("role_x", ["u3"], "u3")).toEqual([]);
  });
});
