import { afterEach, expect, it, vi } from "vitest";
import type { LabelItemDetail } from "@/domain/labeling/items";
import { applySuggestion, createAnnotationDraft, togglePurpose } from "@/features/labeling/draft";
import { exportAnnotations, listLabelItems, saveLabelAnnotation, deleteLabelAnnotation } from "@/features/labeling/service";
const item = { itemId: "meegle:r:99", manualCorrectResult: "人工结论", suggestion: { verdict: "wrong", errorCodes: ["timing_misjudged"], purposes: ["few_shot_negative"], hints: [] } } as unknown as LabelItemDetail;
afterEach(() => vi.unstubAllGlobals());
it("人工建议只显式应用，草稿数组不会改写详情或其他条目", () => {
  const draft = createAnnotationDraft(item);
  expect(draft.verdict).toBeUndefined();
  expect(draft.correctedConclusion).toBe("人工结论");
  const suggested = applySuggestion(draft, item);
  expect(suggested.verdict).toBe("wrong");
  suggested.errorCodes.length = 0;
  expect(item.suggestion.errorCodes).toHaveLength(1);
  expect(createAnnotationDraft(item).errorCodes).toEqual([]);
});
it("排除与其他用途互斥，切换不会隐式选择数据用途", () => {
  expect(togglePurpose(["eval_truth"], "exclude")).toEqual(["exclude"]);
  expect(togglePurpose(["exclude"], "eval_truth")).toEqual(["eval_truth"]);
  expect(togglePurpose(["exclude"], "exclude")).toEqual([]);
});
it("列表筛选编码来源、场景和含特殊字符关键词，不将all当来源提交", async () => {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => new Response(JSON.stringify({ items: [], total: 0, annotated: 0 })));
  vi.stubGlobal("fetch", fetchMock);
  await listLabelItems({ source: "meegle", scene: "vehicle", status: "todo", query: "飞书 #12&34", limit: 500 });
  const url = new URL(fetchMock.mock.calls[0][0] as string, "http://localhost");
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ source: "meegle", scene: "vehicle", status: "todo", q: "飞书 #12&34", limit: "500" });
});
it("非法标注组合在请求前被阻止；保存成功保留返回版本", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ annotation: { itemId: item.itemId, revision: 2 } })));
  vi.stubGlobal("fetch", fetchMock);
  await expect(saveLabelAnnotation(item.itemId, { ...createAnnotationDraft(item), verdict: "wrong", purposes: ["few_shot_negative"] })).rejects.toThrow("错误类型");
  expect(fetchMock).not.toHaveBeenCalled();
  const saved = await saveLabelAnnotation(item.itemId, { ...createAnnotationDraft(item), verdict: "correct", purposes: ["few_shot_positive"] });
  expect(saved.revision).toBe(2);
});
it("撤销失败不会被当成功；导出返回原始JSONL且拒绝错误响应", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "当前账号无权撤销" }), { status: 403 })));
  await expect(deleteLabelAnnotation(item.itemId)).rejects.toThrow("无权撤销");
  await expect(exportAnnotations()).rejects.toThrow("无权撤销");
  const jsonl = '{"id":"jira:r1"}\n';
  vi.stubGlobal("fetch", vi.fn(async () => new Response(jsonl)));
  expect(await exportAnnotations()).toBe(jsonl);
});

it("历史导航暂存草稿按账号和条目隔离，基线版本变化或明确放弃后不恢复", async () => {
  const { readDraft, writeDraft, clearDraft } = await import("@/features/labeling/draft-cache");
  const records = new Map<string, string>();
  const storage = { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => { records.set(key, value); }, removeItem: (key: string) => { records.delete(key); } };
  const baseline = createAnnotationDraft(item);
  const changed = { ...baseline, note: "未提交草稿" };
  writeDraft(storage, "alice", item.itemId, JSON.stringify(baseline), changed);
  expect(readDraft(storage, "alice", item.itemId, baseline)?.note).toBe("未提交草稿");
  expect(readDraft(storage, "bob", item.itemId, baseline)).toBeUndefined();
  expect(readDraft(storage, "alice", "jira:other", baseline)).toBeUndefined();
  expect(readDraft(storage, "alice", item.itemId, { ...baseline, note: "服务器新版本" })).toBeUndefined();
  clearDraft(storage, "alice", item.itemId);
  expect(readDraft(storage, "alice", item.itemId, baseline)).toBeUndefined();
});
