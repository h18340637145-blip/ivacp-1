import { db } from "@/shared/db/database";
import type { KnowledgeChunk, NoteRecord } from "@/domain/entities";
import { chunkText } from "@/domain/knowledge/retrieval";
import { MAX_VERSIONS, noteIndexText, normalizeTags } from "@/domain/knowledge/notes-core";
import { newId } from "@/shared/lib/ids";
import { embedTexts } from "./embed";

export function listNotes(userId: string): Promise<NoteRecord[]> {
  return db.notes.where("userId").equals(userId).toArray();
}

export function newNoteDraft(userId: string): NoteRecord {
  const now = new Date().toISOString();
  return {
    id: newId(),
    userId,
    title: "",
    content: "",
    tags: [],
    pinned: false,
    archived: false,
    chunks: [],
    versions: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 逗号（中英文）分隔的标签输入 → 规范化标签 */
export function parseTagInput(text: string): string[] {
  return normalizeTags(text.split(/[,，]/));
}

/** 过滤 + 排序：置顶优先，其余按更新时间倒序 */
export function filterNotes(notes: NoteRecord[], options: { query: string; tag: string; archived: boolean }): NoteRecord[] {
  const q = options.query.trim().toLowerCase();
  return notes
    .filter((n) => n.archived === options.archived)
    .filter((n) => !options.tag || n.tags.includes(options.tag))
    .filter((n) => !q || `${n.title}\n${n.content}\n${n.tags.join(" ")}`.toLowerCase().includes(q))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
}

async function buildChunks(title: string, content: string): Promise<KnowledgeChunk[]> {
  const pieces = chunkText(noteIndexText(title, content));
  const vectors = pieces.length ? await embedTexts(pieces) : null;
  return pieces.map((text, i) => ({ text, embedding: vectors?.[i] }));
}

function unchanged(a: NoteRecord | undefined, b: NoteRecord | undefined) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function commitNote(previous: NoteRecord | undefined, next: NoteRecord) {
  await db.transaction("rw", db.notes, async () => {
    const current = await db.notes.get(next.id);
    if (!unchanged(current, previous)) throw new Error("笔记已被修改或删除，请返回列表重新加载后再保存");
    await db.notes.put(next);
  });
}

/**
 * 保存笔记：标题或正文变化时把上一版本压入历史（最多 MAX_VERSIONS 个）并重建检索分片；
 * 已归档笔记不参与检索（分片清空）。
 */
export async function saveNote(draft: NoteRecord, tagText: string, expected?: NoteRecord | null): Promise<NoteRecord> {
  const title = draft.title.trim() || "未命名笔记";
  const prev = await db.notes.get(draft.id);
  if (prev && prev.userId !== draft.userId) throw new Error("不能修改其他用户的笔记");
  if (expected !== undefined && !unchanged(prev, expected ?? undefined)) throw new Error("笔记已被修改或删除，请返回列表重新加载后再保存");
  const changed = !prev || prev.title !== title || prev.content !== draft.content;
  const versions =
    prev && changed
      ? [{ title: prev.title, content: prev.content, savedAt: prev.updatedAt }, ...prev.versions].slice(0, MAX_VERSIONS)
      : (prev?.versions ?? []);
  const chunks = changed ? (draft.archived ? [] : await buildChunks(title, draft.content)) : draft.chunks;
  const next: NoteRecord = {
    ...draft,
    title,
    tags: parseTagInput(tagText),
    versions,
    chunks,
    updatedAt: new Date(Math.max(Date.now(), prev ? Date.parse(prev.updatedAt) + 1 : 0)).toISOString(),
  };
  await commitNote(prev, next);
  return next;
}

export async function patchNote(note: NoteRecord, changes: Partial<Pick<NoteRecord, "pinned" | "archived">>) {
  const next = { ...note, ...changes, updatedAt: new Date(Math.max(Date.now(), Date.parse(note.updatedAt) + 1)).toISOString() };
  if ("archived" in changes) next.chunks = next.archived ? [] : await buildChunks(next.title, next.content);
  await commitNote(note, next);
}

export async function deleteNote(id: string) {
  await db.notes.delete(id);
}
