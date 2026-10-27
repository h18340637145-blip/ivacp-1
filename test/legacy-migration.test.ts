import { describe, expect, it } from "vitest";
import { legacyMeegleIssueKeyToTicketKey, migrateLegacyTables } from "@/domain/migration/legacy";
import { parseBackupFile } from "@/domain/storage/backup-format";
import { serializeRecord } from "@/domain/storage/serialization";

const t0 = new Date("2025-01-02T03:04:05.000Z");

const legacy = {
  ruleGroups: [{ id: "rg1", name: "组A", jql: "project = X", expand: "", sortOrder: 0, base_paths: {}, model_to_files: {}, prompts: {}, createdAt: t0, updatedAt: t0 }],
  autoCycleStates: [{ id: "ac1", ruleGroupId: "rg1", isActive: true, intervalMinutes: 15 }],
  filterTasks: [{ id: "f1", ruleGroupId: "rg1", status: "completed", jql: "project = X", issueCount: 1, createdAt: t0 }],
  filteredIssueSnapshots: [{ id: "s1", filterTaskId: "f1", ruleGroupId: "rg1", issueKey: "X-1", summary: "标题", rawData: { a: 1 }, createdAt: t0 }],
  issueProcessTasks: [{ id: "t1", snapshotId: "s1", ruleGroupId: "rg1", status: "completed", createdAt: t0 }],
  issueProcessResults: [{ id: "r1", processTaskId: "t1", issueKey: "X-1", replyText: "结论", reviewStatus: "approved", hasCommentedToJira: true, createdAt: t0 }],
  meegleAssignments: [{ id: "a1", workItemId: 99, workItemTypeKey: "issue", workItemName: "飞书", projectKey: "p", projectName: "P", stateName: "处理中", ruleGroupId: "rg1", assignmentSource: "auto", status: "completed", latestTaskId: "t1", latestResultId: "r1", assignedAt: t0 }],
  meegleIssueSnapshots: [{ id: "s1", assignmentId: "a1", ruleGroupId: "rg1", workItemId: 99, workItemTypeKey: "issue", workItemName: "飞书", projectKey: "p", projectName: "P", stateName: "处理中", rawData: {}, createdAt: t0 }],
  meegleProcessTasks: [{ id: "t1", snapshotId: "s1", assignmentId: "a1", ruleGroupId: "rg1", status: "completed", createdAt: t0 }],
  meegleProcessResults: [{ id: "r1", processTaskId: "t1", snapshotId: "s1", assignmentId: "a1", workItemId: 99, replyText: "飞书结论", reviewStatus: "pending", commentStatus: "succeeded", transitionStatus: "failed", createdAt: t0 }],
  meegleValidationRuns: [{ id: "v1", resultId: "r1", validationStatus: "pass", systemVerdict: "pass", diffSeconds: 0, detail: {}, createdAt: t0 }],
  meegleValidationChecks: [{ id: "c1", runId: "v1", type: "time", status: "pass", message: "ok", createdAt: t0 }],
  issueReviewSamples: [
    { id: "rs1", ruleGroupId: "rg1", issueKey: "X-1", wrongConclusion: "", correctConclusion: "", errorReason: "", createdAt: t0 },
    { id: "rs2", ruleGroupId: "rg1", issueKey: "meegle-p-issue-99", sampleKind: "approved", wrongConclusion: "", correctConclusion: "", errorReason: "", createdAt: t0 },
  ],
  learningMemories: [{ id: "m1", ruleGroupId: "rg1", memoryKey: "meegle-p-issue-99", content: "c", updatedAt: t0 }],
  notes: [{ id: "n1", userId: "u", title: "t", content: "c", tags: [], pinned: false, archived: false, chunks: [], versions: [], createdAt: "x", updatedAt: "x" }],
};

describe("migrateLegacyTables", () => {
  const { tables, report } = migrateLegacyTables(legacy);

  it("merges Jira and Meegle tables with source discriminator", () => {
    expect(tables.snapshots).toHaveLength(2);
    expect(tables.processTasks).toHaveLength(2);
    expect(tables.processResults).toHaveLength(2);
    expect(new Set(tables.processResults!.map((r) => r.source))).toEqual(new Set(["jira", "meegle"]));
  });

  it("keeps Jira ids and prefixes colliding Meegle ids, rewiring references", () => {
    const meegleResult = tables.processResults!.find((r) => r.source === "meegle")!;
    expect(tables.processResults!.find((r) => r.source === "jira")!.id).toBe("r1");
    expect(meegleResult.id).toBe("meegle:r1");
    expect(meegleResult.processTaskId).toBe("meegle:t1");
    expect(meegleResult.snapshotId).toBe("meegle:s1");
    expect(meegleResult.ticketKey).toBe("99");
    const assignment = tables.assignments![0];
    expect(assignment.latestTaskId).toBe("meegle:t1");
    expect(assignment.latestResultId).toBe("meegle:r1");
    expect(tables.validationRuns![0].resultId).toBe("meegle:r1");
    expect(tables.validationChecks![0].runId).toBe("v1");
  });

  it("reports renamed result ids for labeling itemId remap", () => {
    expect(migrateLegacyTables(legacy).renamedResultIds).toEqual({ "meegle:r1": "meegle:r1" });
  });

  it("derives Jira result rule group / snapshot from task and maps comment flag", () => {
    const jira = tables.processResults!.find((r) => r.source === "jira")!;
    expect(jira).toMatchObject({ ruleGroupId: "rg1", snapshotId: "s1", ticketKey: "X-1", commentStatus: "succeeded", transitionStatus: "not_selected" });
    expect(tables.processTasks!.find((t) => t.source === "jira")!.ticketKey).toBe("X-1");
  });

  it("normalizes Meegle sample and memory keys and auto cycle primary key", () => {
    expect(tables.reviewSamples!.map((s) => [s.source, s.ticketKey])).toEqual([["jira", "X-1"], ["meegle", "99"]]);
    expect(tables.learningMemories![0].memoryKey).toBe("99");
    expect(tables.autoCycles).toEqual([{ ruleGroupId: "rg1", isActive: true, intervalMinutes: 15 }]);
    expect(tables.notes).toHaveLength(1);
    expect(report.warnings).toEqual([]);
    expect(report.read.meegleProcessResults).toBe(1);
  });

  it("extracts ticket key from legacy meegle key", () => {
    expect(legacyMeegleIssueKeyToTicketKey("meegle-proj-key-issue-123")).toBe("123");
    expect(legacyMeegleIssueKeyToTicketKey("ABC-1")).toBeNull();
  });
});

describe("parseBackupFile", () => {
  it("accepts legacy backup files and converts them", () => {
    const text = serializeRecord({ format: "jira-analyzer-indexeddb-backup", version: 1, exportedAt: t0.toISOString(), tables: legacy });
    const parsed = parseBackupFile(text);
    expect(parsed.legacyReport).toBeDefined();
    expect(parsed.tables.processResults![0].createdAt).toBeInstanceOf(Date);
  });

  it("round-trips new backup files with dates", () => {
    const text = serializeRecord({ format: "ivacp-backup", version: 1, exportedAt: t0.toISOString(), tables: { ruleGroups: legacy.ruleGroups, bogus: [] } });
    const parsed = parseBackupFile(text);
    expect(parsed.tables.ruleGroups![0].createdAt).toEqual(t0);
    expect(Object.keys(parsed.tables)).toEqual(["ruleGroups"]);
  });

  it("rejects invalid files", () => {
    expect(() => parseBackupFile("{}")).toThrow("不是有效的数据备份文件");
  });
});
