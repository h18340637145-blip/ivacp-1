import assert from "node:assert/strict";
import { it } from "vitest";
import {
  meegleMqlIdentityKey,
  normalizeMeegleFilterResults,
  resolveMeegleMqlFiltering,
  selectMeegleMqlFilterExecutionScope,
  successfulMeegleMqlFilterRuleGroupIds,
} from "@/server/meegle/mql-filtering";

// 逐条移植自旧 scripts/test-meegle-mql-filtering.ts，断言消息保留为中文说明
it("飞书 MQL 筛选裁决、规范化与优先级比较", () => {
  const createdAt = new Date("2026-08-10T08:00:00.000Z");
  const ruleGroups = [
    { id: "z-last", name: "最后规则组", sortOrder: 20, meegleMql: "status = open" },
    { id: "b-first", name: "第一规则组", sortOrder: 10, meegleMql: "status = open" },
    { id: "a-first", name: "同优先级规则组", sortOrder: 10, meegleMql: "status = open" },
  ];

  const item = {
    project_key: "vehicle",
    project_name: "车型项目",
    work_item_info: {
      work_item_id: 42,
      work_item_name: "MQL 命中的缺陷",
      work_item_type_key: "bug",
    },
    state_info: { start_state_key_name: "处理中" },
  };

  const rawIssue = (workItemId: number) => ({
    work_item_id: workItemId,
    work_item_type_key: "issue",
    project_key: "p",
    name: `工单 ${workItemId}`,
    status: "处理中",
  });

  const normalizedFilterResults = normalizeMeegleFilterResults({
    projectKey: "p",
    queryResults: [
      { ruleGroupId: "g1", items: [rawIssue(7), rawIssue(7)] },
      { ruleGroupId: "g2", error: new Error("query failed") },
    ],
  });
  assert.equal(normalizedFilterResults.g1.length, 1, "同一规则组内的重复身份只保留一张快照");
  assert.equal(normalizedFilterResults.g1[0].workItemId, 7);
  assert.equal(Object.hasOwn(normalizedFilterResults, "g2"), false, "失败查询组不产生成功结果");

  const dangerousQueryResults = [
    { ruleGroupId: "__proto__", items: [rawIssue(8)] },
    { ruleGroupId: "empty", items: [] },
  ];
  const dangerousQueryResultsBefore = structuredClone(dangerousQueryResults);
  const dangerousFilterResults = normalizeMeegleFilterResults({
    projectKey: "p",
    queryResults: dangerousQueryResults,
  });
  assert.equal(Object.hasOwn(dangerousFilterResults, "__proto__"), true, "危险规则组 ID 必须作为自有键保留");
  assert.equal(dangerousFilterResults["__proto__"].length, 1);
  assert.equal(Object.hasOwn(dangerousFilterResults, "empty"), true, "0 票成功组也必须保留");
  assert.equal(dangerousFilterResults.empty.length, 0);
  assert.equal(
    Object.entries(dangerousFilterResults).reduce((total, [, items]) => total + items.length, 0),
    1,
    "路由 total 所使用的 Object.entries 必须包含危险键结果",
  );
  assert.deepEqual(dangerousQueryResults, dangerousQueryResultsBefore, "规范化不得修改查询输入");

  const result = resolveMeegleMqlFiltering({
    ruleGroups,
    queryResults: [
      { ruleGroupId: "z-last", items: [item] },
      { ruleGroupId: "a-first", items: [item] },
      { ruleGroupId: "b-first", items: [item] },
    ],
    manualAssignmentIdentities: [],
    runId: "run-1",
    createdAt,
  });

  assert.equal(result.assignments.length, 1, "同一工作项只能生成一个自动分配");
  assert.equal(result.assignments[0].ruleGroupId, "a-first", "sortOrder 相同时按 id 字典序选择赢家");
  assert.deepEqual(
    result.audits.map((audit) => [audit.matchedRuleGroupId, audit.decision]),
    [["a-first", "assigned"], ["b-first", "unassigned"], ["z-last", "unassigned"]],
    "规则组按 sortOrder 和 id 的稳定顺序处理",
  );
  assert.match(result.audits[1].reason, /优先级冲突/);
  assert.match(result.audits[2].reason, /优先级冲突/);
  const priorityFilterResults = normalizeMeegleFilterResults({
    projectKey: "vehicle",
    queryResults: [
      { ruleGroupId: "z-last", items: [item] },
      { ruleGroupId: "a-first", items: [item] },
      { ruleGroupId: "b-first", items: [item] },
    ],
  });
  assert.deepEqual(
    Object.fromEntries(Object.entries(priorityFilterResults).map(([groupId, items]) => [groupId, items.length])),
    { "z-last": 1, "a-first": 1, "b-first": 1 },
    "跨组优先级裁决不得从任一规则组的原始命中结果中删除工作项",
  );

  const manualResult = resolveMeegleMqlFiltering({
    ruleGroups: [ruleGroups[0]],
    queryResults: [{ ruleGroupId: "z-last", items: [item] }],
    manualAssignmentIdentities: [{ projectKey: "vehicle", workItemTypeKey: "bug", workItemId: 42 }],
    runId: "run-manual",
    createdAt,
  });
  assert.equal(manualResult.assignments.length, 0);
  assert.equal(manualResult.audits[0].decision, "skipped_manual_assignment");
  assert.match(manualResult.audits[0].reason, /保留人工分配/);
  const manualFilterResults = normalizeMeegleFilterResults({
    projectKey: "vehicle",
    queryResults: [{ ruleGroupId: "z-last", items: [item] }],
  });
  assert.equal(manualFilterResults["z-last"].length, 1, "人工分配不得从规则组原始命中结果中删除工作项");

  const isolatedFailure = resolveMeegleMqlFiltering({
    ruleGroups: [ruleGroups[0], ruleGroups[1]],
    queryResults: [
      { ruleGroupId: "z-last", error: new Error("MQL unavailable") },
      { ruleGroupId: "b-first", items: [item] },
    ],
    manualAssignmentIdentities: [],
    runId: "run-failure",
    createdAt,
  });
  assert.equal(isolatedFailure.assignments.length, 1, "单组查询失败不能阻断其他规则组");
  assert.equal(isolatedFailure.assignments[0].ruleGroupId, "b-first");
  assert.equal(isolatedFailure.audits.find((audit) => audit.decision === "failed")?.matchedRuleGroupId, "z-last");
  assert.match(isolatedFailure.audits.find((audit) => audit.decision === "failed")?.reason ?? "", /MQL 查询失败/);

  const invalidItems = [
    { ...item, project_key: "" },
    { ...item, work_item_info: { ...item.work_item_info, work_item_type_key: " " } },
    { ...item, work_item_info: { ...item.work_item_info, work_item_id: 0 } },
    { ...item, work_item_info: { ...item.work_item_info, work_item_id: -1 } },
    { ...item, work_item_info: { ...item.work_item_info, work_item_id: 1.5 } },
    { ...item, work_item_info: { ...item.work_item_info, work_item_id: Number.MAX_SAFE_INTEGER + 1 } },
  ];
  const invalidResult = resolveMeegleMqlFiltering({
    ruleGroups: [ruleGroups[0]], queryResults: [{ ruleGroupId: "z-last", items: invalidItems }],
    manualAssignmentIdentities: [], runId: "run-invalid", createdAt,
  });
  assert.equal(invalidResult.assignments.length, 0, "缺 identity 字段或非法 id 的 MQL 工作项不得分配");
  assert.equal(invalidResult.audits.length, invalidItems.length);
  assert.ok(invalidResult.audits.every((audit) => audit.decision === "failed" && /无效 MQL 工作项/.test(audit.reason)));
  assert.ok(invalidResult.audits.every((audit) => audit.matchedRuleGroupId === "z-last"));

  const colonItems = [
    { ...item, project_key: "a:b", work_item_info: { ...item.work_item_info, work_item_type_key: "c", work_item_id: 7 } },
    { ...item, project_key: "a", work_item_info: { ...item.work_item_info, work_item_type_key: "b:c", work_item_id: 7 } },
  ];
  const colonResult = resolveMeegleMqlFiltering({
    ruleGroups: [ruleGroups[0]], queryResults: [{ ruleGroupId: "z-last", items: colonItems }],
    manualAssignmentIdentities: [], runId: "run-colon", createdAt,
  });
  assert.equal(colonResult.assignments.length, 2, "不同含冒号 identity 元组不能碰撞");
  const colonManualResult = resolveMeegleMqlFiltering({
    ruleGroups: [ruleGroups[0]], queryResults: [{ ruleGroupId: "z-last", items: colonItems }],
    manualAssignmentIdentities: [{ projectKey: "a:b", workItemTypeKey: "c", workItemId: 7 }],
    runId: "run-colon-manual", createdAt,
  });
  assert.equal(colonManualResult.assignments.length, 1, "手工 tuple 仅保护其对应的含冒号 identity");
  assert.equal(colonManualResult.audits.filter((audit) => audit.decision === "skipped_manual_assignment").length, 1);

  const jsonTupleManualResult = resolveMeegleMqlFiltering({
    ruleGroups: [ruleGroups[0]], queryResults: [{ ruleGroupId: "z-last", items: colonItems }],
    manualAssignmentIdentities: [" [ \"a:b\", \"c\", 7 ] "],
    runId: "run-json-tuple-manual", createdAt,
  });
  assert.equal(jsonTupleManualResult.assignments.length, 1, "合法 JSON tuple 字符串应保护对应手工身份");
  assert.equal(jsonTupleManualResult.audits.filter((audit) => audit.decision === "skipped_manual_assignment").length, 1);
  assert.equal(meegleMqlIdentityKey({ projectKey: "a:b", workItemTypeKey: "c", workItemId: 7 }), "[\"a:b\",\"c\",7]");
  const legacyColonManualResult = resolveMeegleMqlFiltering({
    ruleGroups: [ruleGroups[0]], queryResults: [{ ruleGroupId: "z-last", items: colonItems }],
    manualAssignmentIdentities: ["a:b:c:7"],
    runId: "run-legacy-colon-manual", createdAt,
  });
  assert.equal(legacyColonManualResult.assignments.length, 2, "旧冒号 key 不能静默保护错误身份");
  assert.equal(legacyColonManualResult.audits.filter((audit) => audit.decision === "skipped_manual_assignment").length, 0);

  const singleGroupScope = selectMeegleMqlFilterExecutionScope(ruleGroups, "z-last");
  assert.deepEqual(
    singleGroupScope.map((group) => group.id),
    ["a-first", "b-first", "z-last"],
    "单规则组运行必须查询所有已配置 MQL 的更高优先级比较组，不查询更低优先级组",
  );

  const targetedConflict = resolveMeegleMqlFiltering({
    ruleGroups,
    queryResults: [
      { ruleGroupId: "a-first", items: [item] },
      { ruleGroupId: "b-first", items: [] },
      { ruleGroupId: "z-last", items: [item] },
    ],
    manualAssignmentIdentities: [],
    runId: "run-targeted-conflict",
    createdAt,
    targetRuleGroupId: "z-last",
  });
  assert.equal(targetedConflict.assignments.length, 0, "单组筛选不得让低优先级规则组抢占高优先级命中");
  assert.deepEqual(
    targetedConflict.audits.map((audit) => [audit.matchedRuleGroupId, audit.decision]),
    [["z-last", "unassigned"]],
    "单组筛选只输出目标规则组的冲突审计，不写入比较组分配",
  );
  assert.match(targetedConflict.audits[0].reason, /优先级冲突/);

  const targetedComparatorFailure = resolveMeegleMqlFiltering({
    ruleGroups,
    queryResults: [
      { ruleGroupId: "a-first", error: new Error("MQL unavailable") },
      { ruleGroupId: "b-first", items: [] },
      { ruleGroupId: "z-last", items: [item] },
    ],
    manualAssignmentIdentities: [],
    runId: "run-targeted-comparator-failure",
    createdAt,
    targetRuleGroupId: "z-last",
  });
  assert.equal(targetedComparatorFailure.assignments.length, 0, "更高优先级比较查询失败时不得让目标组抢占");
  assert.equal(targetedComparatorFailure.audits[0].decision, "failed");
  assert.match(targetedComparatorFailure.audits[0].reason, /优先级比较失败/);
  assert.deepEqual(
    successfulMeegleMqlFilterRuleGroupIds([
      { ruleGroupId: "a-first", error: new Error("MQL unavailable") },
      { ruleGroupId: "b-first", items: [] },
      { ruleGroupId: "z-last", items: [item] },
    ], "z-last"),
    [],
    "更高优先级比较 MQL 查询失败时，目标组不得进入过期分配清理范围",
  );

  const targetedWinner = resolveMeegleMqlFiltering({
    ruleGroups,
    queryResults: [
      { ruleGroupId: "a-first", items: [] },
      { ruleGroupId: "b-first", items: [] },
      { ruleGroupId: "z-last", items: [item] },
    ],
    manualAssignmentIdentities: [],
    runId: "run-targeted-winner",
    createdAt,
    targetRuleGroupId: "z-last",
  });
  assert.equal(targetedWinner.assignments[0]?.ruleGroupId, "z-last", "所有比较组未命中时目标规则组可保留自动分配");
  assert.equal(targetedWinner.audits[0]?.decision, "assigned");
});
