"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Save, Undo2, WandSparkles } from "lucide-react";
import type { LabelItemDetail } from "@/domain/labeling/items";
import { DIFFICULTIES, DIFFICULTY_LABELS, PURPOSES, PURPOSE_INFO, VERDICTS, VERDICT_INFO, describeErrorCodes, type Annotation, type Verdict } from "@/domain/labeling/schema";
import { errorMessage } from "@/shared/lib/errors";
import { formatDateTime } from "@/shared/lib/format";
import { Button, Callout, ConfirmDialog, ErrorState, Field, Select, Textarea } from "@/shared/ui";
import { applySuggestion, createAnnotationDraft, togglePurpose, type AnnotationDraft } from "../draft";
import { clearDraft, readDraft, writeDraft } from "../draft-cache";
import { deleteLabelAnnotation, saveLabelAnnotation } from "../service";

const ERROR_OPTIONS = describeErrorCodes();
interface Props { owner: string; item: LabelItemDetail; canEdit: boolean; onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void; onSaved: () => void }

export function AnnotationEditor({ owner, item, canEdit, onDirty, onBusy, onSaved }: Props) {
  const id = useId();
  const [initial] = useState(() => {
    const base = createAnnotationDraft(item);
    let cached: AnnotationDraft | undefined;
    try { if (canEdit) cached = readDraft(sessionStorage, owner, item.itemId, base); } catch { /* 存储被禁用时仍可编辑 */ }
    return { draft: cached ?? base, baseline: JSON.stringify(base), restored: !!cached };
  });
  const [draft, setDraft] = useState(initial.draft);
  const [baseline, setBaseline] = useState(initial.baseline);
  const [cacheError, setCacheError] = useState(false);
  useEffect(() => { if (initial.restored) onDirty(true); }, [initial.restored, onDirty]);
  const [annotation, setAnnotation] = useState<Annotation | undefined>(item.annotation);
  const [pending, setPending] = useState(false);
  const busyRef = useRef(false);
  const [undoOpen, setUndoOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState("");
  const dirty = JSON.stringify(draft) !== baseline;
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  function update(next: AnnotationDraft) {
    setDraft(next); onDirty(JSON.stringify(next) !== baseline); setMessage("");
    try { writeDraft(sessionStorage, owner, item.itemId, baseline, next); setCacheError(false); }
    catch { setCacheError(true); }
  }
  function start() { if (busyRef.current || !canEdit) return false; busyRef.current = true; setPending(true); onBusy(true); return true; }
  function stop() { busyRef.current = false; setPending(false); onBusy(false); }
  function commit(next: AnnotationDraft, saved?: Annotation) {
    setAnnotation(saved); setDraft(next); setBaseline(JSON.stringify(next)); onDirty(false); onSaved();
    try { clearDraft(sessionStorage, owner, item.itemId); } catch { /* 已保存的服务端结果不因暂存清理失败而回滚 */ }
  }
  async function save() {
    if (!start()) return;
    setError(undefined); setMessage("");
    try {
      const saved = await saveLabelAnnotation(item.itemId, draft);
      commit(createAnnotationDraft({ ...item, annotation: saved }), saved);
      setMessage(`已保存标注，第 ${saved.revision} 版`);
    } catch (error) { setError(errorMessage(error)); }
    finally { stop(); }
  }
  async function undo() {
    if (!start()) return;
    try {
      await deleteLabelAnnotation(item.itemId);
      commit(createAnnotationDraft({ ...item, annotation: undefined }));
      setError(undefined); setMessage("已撤销标注，原始分析保持不变");
    } finally { stop(); }
  }
  function chooseVerdict(verdict: Verdict) {
    update({ ...draft, verdict, errorCodes: verdict === "correct" || verdict === "unusable" ? [] : draft.errorCodes,
      purposes: draft.purposes.filter((purpose) => verdict === "unusable" ? purpose === "exclude" : purpose === "few_shot_positive" ? verdict === "correct" : purpose === "few_shot_negative" ? verdict !== "correct" : true) });
  }
  const needsErrors = draft.verdict === "partial" || draft.verdict === "wrong";
  const needsConclusion = draft.purposes.includes("few_shot_negative") || (needsErrors && draft.purposes.includes("eval_truth"));
  return <section aria-label="标注编辑" className="min-w-0 rounded-xl border border-border bg-surface">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
      <div><h2 className="text-sm font-semibold">人工标注</h2><p className="mt-1 text-xs text-muted-foreground">{annotation ? `第 ${annotation.revision} 版 · ${annotation.labeler} · ${formatDateTime(annotation.updatedAt)}` : "尚未保存标注"}</p></div>
      <Button variant="outline" size="sm" disabled={!canEdit || pending} onClick={() => update(applySuggestion(draft, item))}><WandSparkles aria-hidden />应用预填建议</Button>
    </div>
    <div className="space-y-4 p-4">
      <Callout title="核对提示 · 仅供参考"><ul className="mt-1 list-disc space-y-1 pl-4">{item.suggestion.hints.map((hint, index) => <li key={index}>{hint}</li>)}</ul></Callout>
      {initial.restored && dirty ? <Callout title="已恢复本标签页未保存的草稿">请核对当前分析内容，再保存标注。草稿按账号和条目隔离，关闭标签页后不再保留。</Callout> : null}
      {cacheError ? <Callout tone="warning">浏览器无法暂存草稿，离开前请保存标注。</Callout> : null}
      {!canEdit ? <Callout tone="warning">当前账号可查看标注；保存和撤销需要复核员及以上权限。</Callout> : null}
      <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-5">
        <fieldset disabled={!canEdit || pending} className="min-w-0 space-y-5 disabled:opacity-70">
          <fieldset className="min-w-0"><legend className="mb-2 text-xs font-medium">结论判定 <span className="text-destructive">*</span></legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{VERDICTS.map((verdict) => <Button type="button" key={verdict} variant={draft.verdict === verdict ? "primary" : "outline"} aria-pressed={draft.verdict === verdict} onClick={() => chooseVerdict(verdict)}>{VERDICT_INFO[verdict].label}</Button>)}</div>{draft.verdict ? <p className="mt-2 text-xs text-muted-foreground">{VERDICT_INFO[draft.verdict].hint}</p> : null}</fieldset>
          {needsErrors ? <fieldset className="min-w-0"><legend className="mb-2 text-xs font-medium">错误类型（至少一项）</legend><div className="grid gap-2 sm:grid-cols-2">{ERROR_OPTIONS.map((option) => <label key={option.code} className="flex items-start gap-2 rounded-md border border-border p-2 text-xs"><input type="checkbox" className="mt-0.5 accent-primary" checked={draft.errorCodes.includes(option.code)} onChange={() => update({ ...draft, errorCodes: draft.errorCodes.includes(option.code) ? draft.errorCodes.filter((code) => code !== option.code) : [...draft.errorCodes, option.code] })} /><span><span className="font-medium">{option.label}</span><span className="mt-0.5 block text-muted-foreground">{option.hint}</span></span></label>)}</div></fieldset> : null}
          <fieldset className="min-w-0"><legend className="mb-2 text-xs font-medium">数据用途（可多选）</legend><div className="grid gap-2 sm:grid-cols-2">{PURPOSES.map((purpose) => <label key={purpose} className="flex items-start gap-2 rounded-md border border-border p-2 text-xs"><input type="checkbox" className="mt-0.5 accent-primary" checked={draft.purposes.includes(purpose)} onChange={() => update({ ...draft, purposes: togglePurpose(draft.purposes, purpose) })} /><span><span className="font-medium">{PURPOSE_INFO[purpose].label}</span><span className="mt-0.5 block text-muted-foreground">{PURPOSE_INFO[purpose].hint}</span></span></label>)}</div></fieldset>
          <Field label="正确结论" htmlFor={`${id}-conclusion`} required={needsConclusion} hint="按「现象、证据、结论」写出应有分析；负例和错误样本评测真值必须填写。"><Textarea id={`${id}-conclusion`} value={draft.correctedConclusion} maxLength={20000} rows={6} onChange={(event) => update({ ...draft, correctedConclusion: event.target.value })} /></Field>
          <Field label="难度" htmlFor={`${id}-difficulty`}><Select id={`${id}-difficulty`} value={draft.difficulty} disabled={!canEdit || pending} onValueChange={(difficulty) => update({ ...draft, difficulty: difficulty as AnnotationDraft["difficulty"] })} options={DIFFICULTIES.map((value) => ({ value, label: DIFFICULTY_LABELS[value] }))} /></Field>
          <Field label="备注" htmlFor={`${id}-note`} required={draft.errorCodes.includes("other")} hint="选择「其他」时需说明原因。最多 2000 字。"><Textarea id={`${id}-note`} value={draft.note} maxLength={2000} rows={3} onChange={(event) => update({ ...draft, note: event.target.value })} /></Field>
        </fieldset>
        {error ? <ErrorState title="标注未保存" error={error} /> : null}
        {message ? <p role="status" className="text-xs text-success">{message}</p> : null}
        {canEdit ? <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4"><Button type="submit" variant="primary" loading={pending}><Save aria-hidden />保存标注</Button>{annotation ? <Button type="button" variant="outline" disabled={pending} onClick={() => setUndoOpen(true)}><Undo2 aria-hidden />撤销标注</Button> : null}<span className="text-xs text-muted-foreground">{dirty ? "有未保存的更改" : "独立保存，不修改原始分析"}</span></div> : null}
      </form>
    </div>
    <ConfirmDialog open={undoOpen} onOpenChange={setUndoOpen} title="撤销这条标注？" description="只删除当前账号对此条目的独立标注，原始分析结果不变。未保存的编辑也会清除。" destructive confirmText="确认撤销标注" onConfirm={undo} />
  </section>;
}
