import type { LabelItemDetail } from "@/domain/labeling/items";
import type { AnnotationInput, Purpose } from "@/domain/labeling/schema";

export type AnnotationDraft = Omit<AnnotationInput, "verdict"> & { verdict?: AnnotationInput["verdict"] };

/** 既有标注与建议均不得共享可变数组；建议不自动变成标注。 */
export function createAnnotationDraft(item: LabelItemDetail): AnnotationDraft {
  const saved = item.annotation;
  return {
    verdict: saved?.verdict,
    errorCodes: [...(saved?.errorCodes ?? [])],
    purposes: [...(saved?.purposes ?? [])],
    correctedConclusion: saved?.correctedConclusion ?? item.manualCorrectResult,
    difficulty: saved?.difficulty ?? "medium",
    note: saved?.note ?? "",
  };
}

export function applySuggestion(draft: AnnotationDraft, item: LabelItemDetail): AnnotationDraft {
  return { ...draft, verdict: item.suggestion.verdict, errorCodes: [...item.suggestion.errorCodes], purposes: [...item.suggestion.purposes], correctedConclusion: draft.correctedConclusion || item.manualCorrectResult };
}

export function togglePurpose(purposes: Purpose[], purpose: Purpose): Purpose[] {
  if (purpose === "exclude") return purposes.includes(purpose) ? [] : [purpose];
  const remaining = purposes.filter((item) => item !== "exclude");
  return remaining.includes(purpose) ? remaining.filter((item) => item !== purpose) : [...remaining, purpose];
}
