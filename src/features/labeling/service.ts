"use client";

import type { LabelItemDetail, LabelListFilter, LabelListResult } from "@/domain/labeling/items";
import { LABEL_LIST_MAX_LIMIT } from "@/domain/labeling/items";
import { validateAnnotation, type Annotation } from "@/domain/labeling/schema";
import { apiFetch, ApiError } from "@/shared/lib/api";
import type { AnnotationDraft } from "./draft";

export function listLabelItems(filter: LabelListFilter = {}): Promise<LabelListResult> {
  const params = new URLSearchParams({ status: filter.status ?? "todo", reviewStatus: filter.reviewStatus ?? "all", scene: filter.scene ?? "all", limit: String(filter.limit ?? LABEL_LIST_MAX_LIMIT) });
  if (filter.source) params.set("source", filter.source);
  if (filter.query?.trim()) params.set("q", filter.query.trim());
  return apiFetch(`/api/labeling/items?${params}`);
}

export async function getLabelItem(id: string): Promise<LabelItemDetail> {
  const { item } = await apiFetch<{ item: LabelItemDetail }>(`/api/labeling/items/detail?${new URLSearchParams({ id })}`);
  if (!item || item.itemId !== id) throw new Error("返回的标注条目不匹配，请重新加载");
  return item;
}

export async function saveLabelAnnotation(itemId: string, draft: AnnotationDraft): Promise<Annotation> {
  const annotation = validateAnnotation(draft);
  const response = await apiFetch<{ annotation: Annotation }>("/api/labeling/annotations", { method: "PUT", json: { itemId, annotation } });
  if (!response.annotation || response.annotation.itemId !== itemId) throw new Error("保存响应与当前条目不匹配，请刷新核对");
  return response.annotation;
}

export async function deleteLabelAnnotation(id: string): Promise<void> {
  await apiFetch(`/api/labeling/annotations?${new URLSearchParams({ id })}`, { method: "DELETE" });
}

/** JSONL 即便只有一行也保持文本，不经过 JSON 自动解析。 */
export async function exportAnnotations(): Promise<string> {
  const response = await fetch("/api/labeling/export", { cache: "no-store" });
  const body = await response.text();
  if (!response.ok) {
    let message = `导出失败（HTTP ${response.status}）`;
    try { const parsed = JSON.parse(body); if (typeof parsed.error === "string") message = parsed.error; } catch { /* 保留HTTP提示 */ }
    throw new ApiError(message, response.status, body);
  }
  return body;
}
