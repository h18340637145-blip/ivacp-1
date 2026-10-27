import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { it } from "vitest";

import {
  buildMeegleWorkItemGetArgs,
  chunkMeegleUserKeys,
  normalizeCompleteMeegleCommentsResponse,
  normalizeCompleteMeegleWorkItemResponse,
  normalizeMeegleUsers,
  resolveMeegleUsers,
  resolveMeegleUsersWithStatus,
} from "@/server/meegle/cli";
import {
  loadMeegleWorkItemDetail,
  normalizeMeegleWorkItemDetail,
} from "@/domain/meegle/work-item-detail";

// 逐条移植自旧 scripts/test-meegle-work-item-detail.ts
it("飞书工作项详情：CLI 参数、规范化、分页完整性、用户解析与错误隔离", async () => {
  assert.deepEqual(
    buildMeegleWorkItemGetArgs("project-key", "7072316735"),
    [
      "workitem", "get",
      "--project-key", "project-key",
      "--work-item-id", "7072316735",
      "--fields", '["_all"]',
      "--params", '{"page_size":200}',
      "--envelope",
    ],
    "工作项全字段读取必须用数值型最大页大小，避免 CLI 自动分页保留过期 has_more",
  );

const paginatedFields = Array.from({ length: 101 }, (_, index) => ({
  key: `field_${index}`,
  name: `分页字段 ${index}`,
  value: { page: Math.floor(index / 50) + 1, index },
}));

const detail = normalizeMeegleWorkItemDetail({
  identity: { projectKey: "p", workItemTypeKey: "issue", workItemId: "7" },
  workItem: {
    work_item_attribute: {
      work_item_name: "充电时间异常",
      role_members: [{
        key: "role_x",
        name: "经办人",
        members: [{ key: "u1", name: "旧用户" }],
      }],
    },
    work_item_fields: [
      ...paginatedFields,
      {
        key: "description",
        name: "描述",
        value: "【实际结果】充电时间不符\n【期待结果】时间相符",
      },
      { key: "defect", name: "缺陷描述", value: "必须完整显示" },
    ],
  },
  comments: [{
    comment_id: "c1",
    creator: { user_key: "u2" },
    created_at: "2026-08-11 10:00:00",
    content: [
      "备注正文第一行",
      "备注正文第二行",
      "![](https://example.test/a.png)",
      "![](javascript:alert(1))",
      "![](data:image/png;base64,AAAA)",
      "![](https://user:secret@example.test/private.png)",
    ].join("\n"),
    file_url: [
      "https://example.test/log.zip",
      "javascript:alert(1)",
      "https://user:secret@example.test/private.zip",
      { url: "https://example.test/a.png" },
    ],
  }],
  users: [{ key: "u2", name: "评论人" }],
});

assert.equal(detail.fields.length, 103, "101 个分页字段及描述字段不应被截断");
assert.deepEqual(detail.fields[100].value, { page: 3, index: 100 }, "字段值结构必须原样保留");
assert.equal(detail.descriptionFields.some((field) => field.name === "缺陷描述" && field.value === "必须完整显示"), true);
assert.equal(
  detail.descriptionFields.some((field) => field.key === "description" && String(field.value).includes("【实际结果】充电时间不符")),
  true,
  "通用描述中的实际结果和期待结果必须完整保留",
);
assert.equal(detail.assigneeRole?.key, "role_x");
assert.deepEqual(detail.assigneeRole?.members, [{ key: "u1", name: "旧用户" }]);
assert.equal(detail.comments[0].authorKey, "u2");
assert.equal(detail.comments[0].authorName, "评论人");
assert.equal(detail.comments[0].body, [
  "备注正文第一行",
  "备注正文第二行",
  "![](https://example.test/a.png)",
  "![](javascript:alert(1))",
  "![](data:image/png;base64,AAAA)",
  "![](https://user:secret@example.test/private.png)",
].join("\n"), "评论原文和换行必须保留");
assert.deepEqual(detail.comments[0].attachments, [
  { url: "https://example.test/a.png", name: "a.png", kind: "image" },
  { url: "https://example.test/log.zip", name: "log.zip", kind: "file" },
]);

assert.deepEqual(
  normalizeMeegleUsers({
    data: {
      users: [
        { user_key: "u2", name: "评论人", email: "u2@example.test" },
        { key: "u3", display_name: "备用名字" },
      ],
    },
  }),
  [
    { key: "u2", name: "评论人", email: "u2@example.test" },
    { key: "u3", name: "备用名字" },
  ],
  "CLI user search 输出必须规范化",
);

const batches = chunkMeegleUserKeys([
  "",
  ...Array.from({ length: 45 }, (_, index) => `u${index}`),
  "u1",
]);
assert.deepEqual(batches.map((batch) => batch.length), [20, 20, 5]);
assert.equal(batches.every((batch) => batch.length <= 20), true, "每批 user key 不得超过 20 个");
assert.deepEqual(await resolveMeegleUsers([]), [], "空 user key 不应调用 CLI");

const completeWorkItem = normalizeCompleteMeegleWorkItemResponse({
  data: detail.fields.length > 0 ? {
    work_item_attribute: { work_item_name: "分页票" },
    work_item_fields: paginatedFields,
  } : null,
  meta: { truncated: false },
  error: null,
});
assert.equal((completeWorkItem.work_item_fields as unknown[]).length, 101);
assert.throws(
  () => normalizeCompleteMeegleWorkItemResponse({
    data: { work_item_attribute: {}, work_item_fields: paginatedFields },
    meta: { truncated: true, next_page_token: "secret-page-token" },
  }),
  /自动分页结果不完整/,
);
assert.throws(
  () => normalizeCompleteMeegleWorkItemResponse({
    data: { work_item_attribute: {}, work_item_fields: paginatedFields },
    meta: { stopped_reason: "max_pages" },
  }),
  /自动分页结果不完整/,
);
assert.throws(
  () => normalizeCompleteMeegleWorkItemResponse({ unexpected: [] }),
  /工作项响应格式无效/,
);
assert.deepEqual(normalizeCompleteMeegleCommentsResponse({ comments: [] }), []);
assert.throws(
  () => normalizeCompleteMeegleCommentsResponse({
    data: { comments: [] },
    meta: { stopped_reason: "consecutive_empty_pages" },
  }),
  /自动分页结果不完整/,
);
assert.throws(
  () => normalizeCompleteMeegleCommentsResponse({ unexpected: [] }),
  /评论响应格式无效/,
);

let activeLookups = 0;
let peakLookups = 0;
const observedBatches: string[][] = [];
const resolution = await resolveMeegleUsersWithStatus(
  Array.from({ length: 85 }, (_, index) => `batch-user-${index}`),
  async (batch) => {
    observedBatches.push(batch);
    activeLookups += 1;
    peakLookups = Math.max(peakLookups, activeLookups);
    await new Promise((resolve) => setTimeout(resolve, 5));
    activeLookups -= 1;
    if (batch.includes("batch-user-20")) throw new Error("sensitive stderr token=/private/secret");
    return { data: { users: batch.map((key) => ({ user_key: key, name: `用户 ${key}` })) } };
  },
);
assert.equal(observedBatches.length, 5);
assert.equal(observedBatches.every((batch) => batch.length <= 20), true);
assert.equal(peakLookups <= 4, true, `用户查询并发峰值 ${peakLookups} 超过 4`);
assert.equal(resolution.partialFailure, true);
assert.equal(resolution.users.length, 65, "一个批次失败时应保留其余批次的用户");

const malformedResolution = await resolveMeegleUsersWithStatus(
  Array.from({ length: 25 }, (_, index) => `malformed-user-${index}`),
  async (batch) => batch.includes("malformed-user-20")
    ? { unexpected: [] }
    : { data: { users: batch.map((key) => ({ user_key: key, name: key })) } },
);
assert.equal(malformedResolution.users.length, 20);
assert.equal(malformedResolution.partialFailure, true, "fulfilled 未知用户 wrapper 必须记为部分失败");
assert.equal(malformedResolution.failures.length, 1);

const loggedErrors: Array<{ scope: string; error: unknown }> = [];
const partialResponse = await loadMeegleWorkItemDetail(
  { projectKey: "p", workItemTypeKey: "issue", workItemId: "7" },
  {
    getWorkItem: async () => ({
      work_item_attribute: {},
      work_item_fields: [{ key: "description", name: "描述", value: "正文" }],
    }),
    listComments: async () => [{
      comment_id: "c-partial",
      creator: "known-user",
      created_at: "2026-08-12 10:00:00",
      content: "评论正文",
    }],
    resolveUsers: async () => ({
      users: [{ key: "known-user", name: "已解析作者" }],
      partialFailure: true,
    }),
    logError: (scope, error) => loggedErrors.push({ scope, error }),
  },
);
assert.equal(partialResponse.status, 200);
assert.equal(partialResponse.detail?.comments[0].authorName, "已解析作者");
assert.deepEqual(partialResponse.errors, { commentAuthors: "COMMENT_AUTHORS_PARTIAL_FAILED" });

const commentsFailedResponse = await loadMeegleWorkItemDetail(
  { projectKey: "p", workItemTypeKey: "issue", workItemId: "7" },
  {
    getWorkItem: async () => ({
      work_item_attribute: {},
      work_item_fields: [{ key: "description", name: "描述", value: "仍可展示" }],
    }),
    listComments: async () => normalizeCompleteMeegleCommentsResponse({ unexpected: [] }),
    resolveUsers: async () => { throw new Error("没有评论时不应解析作者"); },
    logError: (scope, error) => loggedErrors.push({ scope, error }),
  },
);
assert.equal(commentsFailedResponse.status, 200);
assert.equal(commentsFailedResponse.detail?.descriptionFields[0].value, "仍可展示");
assert.deepEqual(commentsFailedResponse.errors, { comments: "COMMENTS_UPSTREAM_FAILED" });
assert.equal(JSON.stringify(commentsFailedResponse).includes("unexpected"), false);

const normalizedCliComments = normalizeCompleteMeegleCommentsResponse({
  data: {
    comments: [{
      comment_id: "c-cli",
      creator: { user_key: "u-cli" },
      created_at: "2026-08-12 12:00:00",
      content: "CLI 评论",
      file_url: [
        { url: "https://example.test/from-cli.zip", name: "日志.zip" },
        "data:text/plain,secret",
      ],
    }],
  },
  meta: { truncated: false },
});
const cliDetail = normalizeMeegleWorkItemDetail({
  identity: { projectKey: "p", workItemTypeKey: "issue", workItemId: "7" },
  workItem: { work_item_attribute: {}, work_item_fields: [] },
  comments: normalizedCliComments,
});
assert.deepEqual(cliDetail.comments[0].attachments, [{
  url: "https://example.test/from-cli.zip",
  name: "日志.zip",
  kind: "file",
}], "CLI 评论规范化不得丢失 file_url 数组或对象");

const sensitiveError = new Error("meegle --token abc stderr /home/private");
const failedResponse = await loadMeegleWorkItemDetail(
  { projectKey: "p", workItemTypeKey: "issue", workItemId: "7" },
  {
    getWorkItem: async () => { throw sensitiveError; },
    listComments: async () => { throw new Error("comments stderr secret"); },
    resolveUsers: async () => ({ users: [], partialFailure: false }),
    logError: (scope, error) => loggedErrors.push({ scope, error }),
  },
);
assert.equal(failedResponse.status, 502);
assert.equal(failedResponse.detail, null);
assert.deepEqual(failedResponse.errors, {
  workItem: "WORK_ITEM_UPSTREAM_FAILED",
  comments: "COMMENTS_UPSTREAM_FAILED",
});
assert.equal(JSON.stringify(failedResponse).includes("token"), false, "响应不得泄漏 CLI 错误");
assert.equal(loggedErrors.some(({ error }) => error === sensitiveError), true, "服务端日志应保留原始错误对象");

const cliSource = await readFile(path.join(process.cwd(), "src/server/meegle/cli.ts"), "utf8");
assert.match(cliSource, /"--fields",\s*'\["_all"\]'/);
assert.match(cliSource, /"--params",\s*JSON\.stringify\(\{ page_size: 200 \}\)/);
assert.equal((cliSource.match(/"--envelope"/g) ?? []).length >= 2, true);

});
