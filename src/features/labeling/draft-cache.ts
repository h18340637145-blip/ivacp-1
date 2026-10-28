import { isRejectReasonCode } from "@/domain/analysis/reject-reasons";
import { DIFFICULTIES, PURPOSES, VERDICTS } from "@/domain/labeling/schema";
import type { AnnotationDraft } from "./draft";

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const key = (owner: string, itemId: string) => `ivacp-label-draft:${JSON.stringify([owner, itemId])}`;

/** 仅暂存未提交的界面草稿，按账号/条目隔离；服务端基线变化时不重放旧草稿。 */
export function readDraft(storage: DraftStorage, owner: string, itemId: string, baseline: AnnotationDraft): AnnotationDraft | undefined {
  try {
    const value = JSON.parse(storage.getItem(key(owner, itemId)) ?? "null");
    if (!value || value.version !== 1 || value.baseline !== JSON.stringify(baseline)) return;
    const draft = value.draft;
    if (!draft || (draft.verdict !== undefined && !VERDICTS.includes(draft.verdict))
      || !Array.isArray(draft.errorCodes) || !draft.errorCodes.every(isRejectReasonCode)
      || !Array.isArray(draft.purposes) || !draft.purposes.every((purpose: unknown) => PURPOSES.includes(purpose as typeof PURPOSES[number]))
      || !DIFFICULTIES.includes(draft.difficulty) || typeof draft.correctedConclusion !== "string" || draft.correctedConclusion.length > 20000
      || typeof draft.note !== "string" || draft.note.length > 2000) return;
    return { ...draft, errorCodes: [...draft.errorCodes], purposes: [...draft.purposes] };
  } catch { return; }
}

export function writeDraft(storage: DraftStorage, owner: string, itemId: string, baseline: string, draft: AnnotationDraft): void {
  if (JSON.stringify(draft) === baseline) clearDraft(storage, owner, itemId);
  else storage.setItem(key(owner, itemId), JSON.stringify({ version: 1, baseline, draft }));
}

export function clearDraft(storage: DraftStorage, owner: string, itemId: string): void {
  storage.removeItem(key(owner, itemId));
}
