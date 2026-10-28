import { db } from "@/shared/db/database";
import type { ChatMessageRecord, KnowledgeDoc } from "@/domain/entities";
import { retrieveChunks, type RetrievedChunk } from "@/domain/knowledge/retrieval";
import { ApiError } from "@/shared/lib/api";
import { embedOne } from "./embed";
import { recallMemories } from "./memory-service";

export async function listChatMessages(userId: string): Promise<ChatMessageRecord[]> {
  return db.chatMessages.where("userId").equals(userId).sortBy("createdAt");
}

export async function saveChatMessage(message: ChatMessageRecord) {
  await db.chatMessages.put(message);
}

export async function clearChatMessages(userId: string) {
  await db.chatMessages.where("userId").equals(userId).delete();
}

export interface PreparedContext {
  context: RetrievedChunk[];
  memories: string[];
}

/** 组装检索上下文：知识库文档 + 未归档笔记（作为伪文档）+ 召回的长期记忆 */
export async function prepareContext(userId: string, text: string): Promise<PreparedContext> {
  const notes = (await db.notes.where("userId").equals(userId).toArray())
    .filter((n) => !n.archived && n.chunks.length)
    .map(
      (n): KnowledgeDoc => ({ id: n.id, userId, name: `笔记：${n.title}`, size: 0, chunks: n.chunks, createdAt: n.updatedAt }),
    );
  const allDocs = [...(await db.knowledgeDocs.where("userId").equals(userId).toArray()), ...notes];
  const hasVectors = allDocs.some((d) => d.chunks.some((c) => c.embedding));
  const memCount = await db.memories.where("userId").equals(userId).count();
  const qv = hasVectors || memCount ? ((await embedOne(text)) ?? null) : null;
  const context = retrieveChunks(allDocs, text, qv);
  const memories = (await recallMemories(userId, text, qv)).map((m) => m.content);
  return { context, memories };
}

type StreamEvent = { type: "delta"; text: string } | { type: "done"; reply: string } | { type: "error"; error: string };

/**
 * 流式请求 /api/chat（NDJSON）。每收到一个增量调用 onDelta(累计文本)；返回完整回复。
 */
export async function streamChat(
  body: { message: string; history: Array<{ role: string; content: string }>; context: RetrievedChunk[]; memories: string[] },
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, context: body.context.map(({ docName, text }) => ({ docName, text })), stream: true }),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(data.error ?? `对话失败（HTTP ${res.status}）`, res.status, data);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";
  let finalReply: string | null = null;

  const handle = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as StreamEvent;
    if (event.type === "delta") {
      reply += event.text;
      onDelta(reply);
    } else if (event.type === "done") {
      finalReply = event.reply;
    } else if (event.type === "error") {
      throw new Error(event.error);
    }
  };

  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(handle);
    }
    handle(buffer + decoder.decode());
    signal?.throwIfAborted();
    if (finalReply === null) throw new Error("对话流已中断，未收到完整回复，请重试");
    return (finalReply as string).trim();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
