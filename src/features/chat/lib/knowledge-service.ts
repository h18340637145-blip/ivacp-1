import { db } from "@/shared/db/database";
import type { KnowledgeDoc } from "@/domain/entities";
import { chunkText } from "@/domain/knowledge/retrieval";
import { newId } from "@/shared/lib/ids";
import { embedTexts } from "./embed";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const ACCEPTED_FILE_TYPES = ".txt,.md,.json,.csv,.log,text/*";

export async function listKnowledgeDocs(userId: string): Promise<KnowledgeDoc[]> {
  const docs = await db.knowledgeDocs.where("userId").equals(userId).toArray();
  return docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 按文档名或分片正文检索（大小写不敏感） */
export function searchDocs(docs: KnowledgeDoc[], query: string, limit = 100): KnowledgeDoc[] {
  const q = query.trim().toLowerCase();
  return docs
    .filter((d) => !q || d.name.toLowerCase().includes(q) || d.chunks.some((c) => c.text.toLowerCase().includes(q)))
    .slice(0, limit);
}

export interface UploadOutcome {
  added: number;
  notices: string[];
}

/** 上传文本文件：超过 2MB 或内容为空的跳过；向量服务不可用时仅保存分片（关键词检索） */
export async function uploadKnowledgeFiles(userId: string, files: File[]): Promise<UploadOutcome> {
  const notices: string[] = [];
  let added = 0;
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      notices.push(`${file.name} 超过 2MB，已跳过`);
      continue;
    }
    const pieces = chunkText(await file.text());
    if (!pieces.length) {
      notices.push(`${file.name} 内容为空或不是文本文件`);
      continue;
    }
    const vectors = await embedTexts(pieces);
    if (!vectors && !notices.includes("向量服务不可用，已仅按关键词检索")) notices.push("向量服务不可用，已仅按关键词检索");
    await db.knowledgeDocs.put({
      id: newId(),
      userId,
      name: file.name,
      size: file.size,
      chunks: pieces.map((text, i) => ({ text, embedding: vectors?.[i] })),
      createdAt: new Date().toISOString(),
    });
    added += 1;
  }
  return { added, notices };
}

export async function deleteKnowledgeDoc(id: string) {
  await db.knowledgeDocs.delete(id);
}

/** 升级前没有 userId 的旧数据归当前登录用户 */
export async function claimOrphanRecords(userId: string) {
  await db.chatMessages.filter((m) => !m.userId).modify({ userId });
  await db.knowledgeDocs.filter((d) => !d.userId).modify({ userId });
}
