import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/shared/db/database";
import { streamChat } from "@/features/chat/lib/conversation";
import { claimOrphanRecords } from "@/features/chat/lib/knowledge-service";
import { newNoteDraft, patchNote, saveNote } from "@/features/chat/lib/notes-service";
const { embed } = vi.hoisted(() => ({ embed: vi.fn(async () => null as number[][] | null) }));
vi.mock("@/features/chat/lib/embed", () => ({ embedTexts: embed, embedOne: async () => undefined }));
afterEach(async () => { vi.unstubAllGlobals(); embed.mockReset(); embed.mockResolvedValue(null); await Promise.all([db.notes.clear(), db.memories.clear(), db.chatMessages.clear(), db.knowledgeDocs.clear()]); });
const body = { message: "问题", history: [], context: [], memories: [] };
describe("对话流完整性", () => {
  it("跨字节分片还原中文与done最终回复", async () => {
    const data = new TextEncoder().encode('{"type":"delta","text":"中文"}\n{"type":"done","reply":"最终中文"}\n');
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(controller) { for (const byte of data) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }))));
    const deltas: string[] = [];
    expect(await streamChat(body, text => deltas.push(text))).toBe("最终中文"); expect(deltas).toEqual(["中文"]);
  });
  it("中断的流不能把部分文本当作成功回复", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"type":"delta","text":"半截结论"}\n')));
    await expect(streamChat(body, () => undefined)).rejects.toThrow(/中断/);
  });
});
describe("助手数据归属与笔记并发", () => {
  it("四类孤儿记录原子归首次登录者，不改其他账号", async () => {
    for (const name of ["chatMessages", "knowledgeDocs", "memories", "notes"] as const) {
      await db.table(name).bulkPut([{ id: "orphan" }, { id: "other", userId: "bob" }]);
    }
    await claimOrphanRecords("alice"); await claimOrphanRecords("carol");
    for (const name of ["chatMessages", "knowledgeDocs", "memories", "notes"] as const) {
      expect(await db.table(name).get("orphan")).toMatchObject({ userId: "alice" }); expect(await db.table(name).get("other")).toMatchObject({ userId: "bob" });
    }
  });
  it("向量化等待期间被更新的笔记不能被迟到保存覆盖", async () => {
    const original = await saveNote({ ...newNoteDraft("alice"), title: "旧标题", content: "旧内容" }, "");
    let release!: (vectors: null) => void; let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
    embed.mockImplementationOnce(() => { started(); return new Promise(resolve => { release = resolve; }); });
    const saving = saveNote({ ...original, content: "迟到的内容" }, "");
    const result = expect(saving).rejects.toThrow(/已.*修改|变化/);
    await ready; await db.notes.update(original.id, { content: "另一个标签页的新内容" }); release(null); await result;
    expect((await db.notes.get(original.id))?.content).toBe("另一个标签页的新内容");
  });
  it("迟到的取消归档不能复活已删除笔记", async () => {
    const original = await saveNote({ ...newNoteDraft("alice"), archived: true, title: "已归档", content: "正文" }, "");
    let release!: (vectors: null) => void; let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
    embed.mockImplementationOnce(() => { started(); return new Promise(resolve => { release = resolve; }); });
    const patching = patchNote(original, { archived: false }); const result = expect(patching).rejects.toThrow(/删除|变化/);
    await ready; await db.notes.delete(original.id); release(null); await result; expect(await db.notes.get(original.id)).toBeUndefined();
  });
});
