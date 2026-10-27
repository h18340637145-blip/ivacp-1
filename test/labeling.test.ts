import { describe, expect, it } from "vitest";
import { suggestLabels, toExportRecord, validateAnnotation, type Annotation } from "@/domain/labeling/schema";
import { displayIssueKey, filterLabelItems, makeItemId, parseItemId, type LabelItemSummary } from "@/domain/labeling/items";
import { serializeRecord } from "@/domain/storage/serialization";

const base = { verdict: "wrong", errorCodes: ["signal_missed"], purposes: [], correctedConclusion: "", difficulty: "medium", note: "" };

describe("标注校验", () => {
  it("要求判定与错误类型匹配", () => {
    expect(() => validateAnnotation({})).toThrow("结论判定");
    expect(() => validateAnnotation({ ...base, errorCodes: [] })).toThrow("错误类型");
    expect(() => validateAnnotation({ ...base, verdict: "correct" })).toThrow("不应勾选");
    expect(() => validateAnnotation({ ...base, errorCodes: ["other"] })).toThrow("备注");
  });

  it("校验用途约束", () => {
    expect(() => validateAnnotation({ ...base, purposes: ["few_shot_positive"] })).toThrow("完全正确");
    expect(() => validateAnnotation({ ...base, purposes: ["few_shot_negative"] })).toThrow("正确结论");
    expect(() => validateAnnotation({ ...base, purposes: ["eval_truth"] })).toThrow("正确结论");
    expect(() => validateAnnotation({ ...base, verdict: "unusable", errorCodes: [], purposes: ["eval_truth"] })).toThrow("无法标注");
    expect(() => validateAnnotation({ ...base, purposes: ["exclude", "eval_truth"], correctedConclusion: "x" })).toThrow("排除");
    const ok = validateAnnotation({ ...base, purposes: ["few_shot_negative"], correctedConclusion: " 正确 ", errorCodes: ["signal_missed", "bogus", "signal_missed"] });
    expect(ok.errorCodes).toEqual(["signal_missed"]);
    expect(ok.correctedConclusion).toBe("正确");
  });
});

describe("预填建议与导出", () => {
  it("按复核状态给出建议", () => {
    expect(suggestLabels({ reviewStatus: "approved", replyText: "x".repeat(200) + " 10:00:00" }).purposes).toEqual(["few_shot_positive"]);
    const rejected = suggestLabels({ reviewStatus: "rejected", errorReason: "漏提信号", manualCorrectResult: "对", replyText: "短" });
    expect(rejected.verdict).toBe("wrong");
    expect(rejected.errorCodes).toEqual(["signal_missed"]);
    expect(rejected.purposes).toContain("few_shot_negative");
    expect(rejected.hints.some((h) => h.includes("时间戳"))).toBe(true);
  });

  it("不导出排除/无法标注/无用途的条目", () => {
    const item = { itemId: "jira:1", source: "jira" as const, issueKey: "K-1", aiConclusion: "ai" };
    const make = (patch: Partial<Annotation>): Annotation => ({
      itemId: "jira:1", verdict: "wrong", errorCodes: ["log_missing"], purposes: ["eval_truth"], correctedConclusion: "c",
      difficulty: "easy", note: "", labeler: "u", revision: 1, updatedAt: "t", ...patch,
    });
    expect(toExportRecord(item, make({}))).toMatchObject({ issueKey: "K-1", correctedConclusion: "c" });
    expect(toExportRecord(item, make({ purposes: ["exclude"] }))).toBeNull();
    expect(toExportRecord(item, make({ purposes: [] }))).toBeNull();
    expect(toExportRecord(item, make({ verdict: "unusable", purposes: [] }))).toBeNull();
  });
});

describe("标注条目辅助", () => {
  const make = (patch: Partial<LabelItemSummary>): LabelItemSummary => ({
    itemId: "jira:1", source: "jira", issueKey: "K-1", title: "台架 雨刮异常", scene: "bench", reviewStatus: "pending",
    excerpt: "", annotated: false, updatedAt: "2026-01-01T00:00:00.000Z", ...patch,
  });

  it("条目 ID 往返与非法 ID", () => {
    expect(parseItemId(makeItemId("meegle", "abc:1"))).toEqual({ source: "meegle", recordId: "abc:1" });
    expect(() => parseItemId("foo:1")).toThrow("无效的条目 ID");
    expect(() => parseItemId("jira:")).toThrow("无效的条目 ID");
    expect(() => parseItemId("")).toThrow("无效的条目 ID");
    expect(displayIssueKey("jira", "K-1")).toBe("K-1");
    expect(displayIssueKey("meegle", "123")).toBe("飞书 #123");
  });

  it("按状态、来源、复核状态、场景与关键字过滤，统计总数与已标注数", () => {
    const all = [
      make({}),
      make({ itemId: "jira:2", issueKey: "K-2", title: "实车 门锁", scene: "vehicle", annotated: true, verdict: "correct", reviewStatus: "approved" }),
      make({ itemId: "meegle:3", source: "meegle", issueKey: "飞书 #3", title: "无标志", scene: undefined }),
    ];
    expect(filterLabelItems(all, {})).toMatchObject({ total: 3, annotated: 1 });
    expect(filterLabelItems(all, { status: "todo" }).items.map((i) => i.itemId)).toEqual(["jira:1", "meegle:3"]);
    expect(filterLabelItems(all, { status: "done" }).items.map((i) => i.itemId)).toEqual(["jira:2"]);
    expect(filterLabelItems(all, { source: "meegle" }).total).toBe(1);
    expect(filterLabelItems(all, { reviewStatus: "approved" }).total).toBe(1);
    expect(filterLabelItems(all, { scene: "none" }).items[0].itemId).toBe("meegle:3");
    expect(filterLabelItems(all, { scene: "bench" }).items[0].itemId).toBe("jira:1");
    expect(filterLabelItems(all, { query: "门锁" }).items[0].itemId).toBe("jira:2");
    expect(filterLabelItems(all, { query: "飞书" }).items[0].itemId).toBe("meegle:3");
    const limited = filterLabelItems(all, { limit: 1 });
    expect(limited.items.length).toBe(1);
    expect(limited.total).toBe(3);
  });
});

describe.skipIf(!process.env.MYSQL_URL)("标注系统 MySQL", () => {
  it("读取镜像条目并完成保存、导出、撤销", async () => {
    const { listItems, getItem, saveAnnotation, deleteAnnotation, exportJsonl } = await import("@/server/labeling/labeling");
    const { pushRecords } = await import("@/server/db/mirror");
    const { getPool, closePools } = await import("@/server/db/mysql");
    const owner = `vitest-labeling-${Date.now()}`;
    const createdAt = new Date("2026-03-01T08:00:00Z");
    const reply = "AI 结论：10:00:01 信号 VehSpd 跳变，" + "证据充分。".repeat(30);
    await pushRecords({
      owner,
      records: [
        { table: "snapshots", id: "s1", data: serializeRecord({ id: "s1", source: "jira", ticketKey: "VT-1", ruleGroupId: "g", origin: "process", title: "【台架】车速跳变", rawData: {}, createdAt }) },
        { table: "snapshots", id: "s2", data: serializeRecord({ id: "s2", source: "meegle", ticketKey: "9001", ruleGroupId: "g", origin: "process", title: "实车 门锁异常", rawData: {}, createdAt }) },
        { table: "processResults", id: "r1", data: serializeRecord({ id: "r1", source: "jira", ticketKey: "VT-1", ruleGroupId: "g", processTaskId: "t", snapshotId: "s1", replyText: reply, signalSummary: "VehSpd", reviewStatus: "rejected", errorReason: "漏提信号", errorCategory: "signal_missed", manualReviewedAt: createdAt, commentStatus: "none", transitionStatus: "none", createdAt }) },
        { table: "processResults", id: "r2", data: serializeRecord({ id: "r2", source: "meegle", ticketKey: "9001", ruleGroupId: "g", processTaskId: "t", snapshotId: "missing", replyText: "短结论", reviewStatus: "pending", commentStatus: "none", transitionStatus: "none", createdAt }) },
      ],
    });

    try {
      const list = await listItems(owner, { status: "all" });
      expect(list).toMatchObject({ total: 2, annotated: 0 });
      const jira = list.items.find((item) => item.itemId === "jira:r1");
      expect(jira).toMatchObject({ issueKey: "VT-1", title: "【台架】车速跳变", scene: "bench", reviewStatus: "rejected", errorCategory: "signal_missed" });
      // 快照缺失时按 source+ticketKey 回退到最新快照标题
      expect(list.items.find((item) => item.itemId === "meegle:r2")).toMatchObject({ issueKey: "飞书 #9001", title: "实车 门锁异常", scene: "vehicle" });
      expect((await listItems(owner, { source: "meegle" })).total).toBe(1);

      const detail = await getItem(owner, "jira:r1");
      expect(detail?.replyText).toBe(reply);
      expect(detail?.suggestion.verdict).toBe("wrong");
      expect(detail?.suggestion.hints.length).toBeGreaterThan(0);
      expect(await getItem(owner, "meegle:r1")).toBeNull();

      const saved = await saveAnnotation(owner, "vitest", "jira:r1", {
        verdict: "partial", errorCodes: ["timing_misjudged"], purposes: ["few_shot_negative"], correctedConclusion: "测试正确结论", difficulty: "hard", note: "",
      });
      expect(saved.revision).toBe(1);
      const again = await saveAnnotation(owner, "vitest", "jira:r1", {
        verdict: "partial", errorCodes: ["timing_misjudged"], purposes: ["few_shot_negative"], correctedConclusion: "测试正确结论2", difficulty: "hard", note: "",
      });
      expect(again.revision).toBe(2);
      const exported = await exportJsonl(owner);
      expect(exported).toContain("测试正确结论2");
      expect(JSON.parse(exported.trim())).toMatchObject({ id: "jira:r1", issueKey: "VT-1", scene: "bench", aiConclusion: reply });
      expect((await listItems(owner, { status: "done" })).items.map((item) => item.itemId)).toEqual(["jira:r1"]);
      await expect(saveAnnotation(owner, "vitest", "jira:does-not-exist", { verdict: "correct" })).rejects.toThrow("不存在");

      await deleteAnnotation(owner, "jira:r1");
      expect(await exportJsonl(owner)).toBe("");
      expect((await listItems(owner, {})).annotated).toBe(0);
    } finally {
      const pool = await getPool();
      await pool.query("DELETE FROM sync_records WHERE owner = ?", [owner]);
      await pool.query("DELETE FROM labeling_annotations WHERE owner = ?", [owner]);
      await closePools();
    }
  });
});
