import { expect, it } from "vitest";
import { normalizeMeegleUsers } from "@/server/meegle/cli";
import { normalizeMeegleWorkItemDetail } from "@/domain/meegle/work-item-detail";

it("真实CLI的name_cn/name_en用于评论作者显示，不退化为user_key", () => {
  const users = normalizeMeegleUsers([
    { user_key: "author-1", name_cn: "测试成员", name_en: "Test Member", username: "" },
    { user_key: "author-2", name_cn: "", name_en: "Second Member", username: "" },
  ]);
  const detail = normalizeMeegleWorkItemDetail({ identity: { projectKey: "project-test", workItemTypeKey: "issue", workItemId: "7148399110" }, workItem: {}, comments: [{ creator: "author-1", content: "第一条" }, { creator: "author-2", content: "第二条" }], users });
  expect(detail.comments.map(comment => comment.authorName)).toEqual(["测试成员", "Second Member"]);
});
