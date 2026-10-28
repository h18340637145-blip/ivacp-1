import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/shared/db/database";
import { MAX_FILE_BYTES, uploadKnowledgeFiles } from "@/features/chat/lib/knowledge-service";
import { prepareContext } from "@/features/chat/lib/conversation";
import { importProcessedHistory } from "@/features/chat/lib/import-history";
import { newNoteDraft, patchNote, saveNote } from "@/features/chat/lib/notes-service";
import { addManualMemory, forgetStaleMemories, recallMemories, rememberExchange } from "@/features/chat/lib/memory-service";
const { embed } = vi.hoisted(() => ({ embed: vi.fn<(texts: string[]) => Promise<number[][] | null>>(async () => null) }));
vi.mock("@/features/chat/lib/embed", () => ({ embedTexts: embed, embedOne: async (text: string) => (await embed([text]))?.[0] }));
afterEach(async () => { vi.unstubAllGlobals(); embed.mockReset(); embed.mockResolvedValue(null); await Promise.all([db.notes.clear(), db.memories.clear(), db.chatMessages.clear(), db.knowledgeDocs.clear(), db.processResults.clear(), db.analysisHistories.clear(), db.reviewSamples.clear()]); });
describe("助手知识沉淀与召回", () => {
  it("上传只保存非空、符合大小与文本格式的文件，向量失败仍可关键词召回", async () => {
    const result = await uploadKnowledgeFiles("alice", [new File(["CAN 资料"], "can.md"), new File([""], "empty.txt"), new File([new Uint8Array(MAX_FILE_BYTES + 1)], "large.log"), new File(["image bytes"], "image.png", { type: "image/png" })]);
    expect(result.added).toBe(1); expect(result.notices).toHaveLength(4);
    const context = await prepareContext("alice", "CAN"); expect(context.context.map(chunk => chunk.docName)).toEqual(["can.md"]); expect((await prepareContext("bob", "CAN")).context).toEqual([]);
  });
  it("笔记保留最近20个版本，归档不参与召回且恢复后重建分片", async () => {
    let note = await saveNote({ ...newNoteDraft("alice"), title: "CAN笔记", content: "版本0" }, "CAN");
    for (let i = 1; i <= 22; i++) note = await saveNote({ ...note, content: `CAN版本${i}` }, "CAN");
    expect(note.versions).toHaveLength(20); expect(note.versions[0].content).toBe("CAN版本21");
    expect((await prepareContext("alice", "CAN")).context).toHaveLength(1);
    await patchNote(note, { archived: true }); expect((await prepareContext("alice", "CAN")).context).toHaveLength(0);
    note = (await db.notes.get(note.id))!; await patchNote(note, { archived: false }); expect((await prepareContext("alice", "CAN")).context).toHaveLength(1);
    await expect(saveNote({ ...note, content: "旧编辑器" }, "", note)).rejects.toThrow(/修改|删除/);
  });
  it("导入结果/历史/人工标注可重复覆盖，包含纠错文本且不导入曲线", async () => {
    await db.table("processResults").put({ id: "r", source: "jira", ticketKey: "A-1", replyText: "AI 原结论", manualCorrectResult: "人工纠正", reviewStatus: "rejected", traceData: { SECRET_TRACE: [1, 2] }, createdAt: new Date() });
    await db.table("analysisHistories").put({ id: "h", source: "meegle", ticketKey: "42", replyText: "历史结论", reviewStatus: "pending", resultCreatedAt: new Date(), archivedAt: new Date() });
    await db.table("reviewSamples").put({ id: "s", source: "jira", ticketKey: "A-1", sampleKind: "rejected", wrongConclusion: "错误", correctConclusion: "正确", createdAt: new Date() });
    expect(await importProcessedHistory("alice")).toMatchObject({ total: 3, jira: 1, histories: 1, samples: 1, withVectors: false });
    await importProcessedHistory("alice"); expect(await db.knowledgeDocs.count()).toBe(3);
    const docs = await db.knowledgeDocs.toArray(); expect(JSON.stringify(docs)).toContain("人工纠正"); expect(JSON.stringify(docs)).not.toContain("SECRET_TRACE"); expect((await prepareContext("bob", "人工")).context).toHaveLength(0);
  });
  it("记忆按用户召回，置顶不会遗忘，自动抽取支持UPDATE/NOOP", async () => {
    embed.mockImplementation(async (texts: string[]) => texts.map(() => [1, 0]));
    await addManualMemory("alice", "CAN 喜欢旧风格"); await addManualMemory("bob", "CAN 私有风格");
    const original = (await db.memories.where("userId").equals("alice").first())!;
    let action = "UPDATE";
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => new Response(JSON.stringify(JSON.parse(init.body).action === "extract" ? { memories: [{ content: "CAN 喜欢新风格", importance: 0.9, type: "preference" }] } : { decision: action === "UPDATE" ? { action, index: 0, content: "CAN 喜欢新风格" } : { action } }), { headers: { "content-type": "application/json" } })));
    await rememberExchange("alice", "问题", "回答"); expect((await db.memories.get(original.id))?.content).toBe("CAN 喜欢新风格");
    action = "NOOP"; await rememberExchange("alice", "问题", "回答"); expect(await db.memories.where("userId").equals("alice").count()).toBe(1);
    expect((await recallMemories("alice", "CAN", [1, 0])).map(row => row.userId)).toEqual(["alice"]);
    await db.memories.update(original.id, { importance: 0.1, pinned: true, lastAccessedAt: 0 }); await forgetStaleMemories("alice"); expect(await db.memories.get(original.id)).toBeDefined();
    await db.memories.update(original.id, { pinned: false }); await forgetStaleMemories("alice"); expect(await db.memories.get(original.id)).toBeUndefined(); expect(await db.memories.where("userId").equals("bob").count()).toBe(1);
  });
});
