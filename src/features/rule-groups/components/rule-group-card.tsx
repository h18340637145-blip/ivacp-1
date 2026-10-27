"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FileCode2, GripVertical, Pencil, Settings2, Trash2 } from "lucide-react";
import type { RuleGroup } from "@/domain/entities";
import { filledPromptCount } from "@/domain/rule-groups/form";
import { formatDateTime } from "@/shared/lib/format";
import { Badge, Button } from "@/shared/ui";

interface Props {
  group: RuleGroup;
  canManage: boolean;
  sortingDisabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
}

export function RuleGroupCard({ group, canManage, sortingDisabled, onEdit, onRemove }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: group.id, disabled: sortingDisabled });
  const models = Object.keys(group.model_to_files ?? {});
  return (
    <article ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      aria-label={`规则组 ${group.name}`} data-rule-group-id={group.id}
      className={`flex min-w-0 flex-col rounded-xl border bg-surface ${isDragging ? "z-10 border-primary shadow-lg" : "border-border"}`}>
      <div className="flex items-start gap-2 border-b border-border p-4">
        {canManage ? <Button {...attributes} {...listeners} size="icon" variant="ghost" disabled={sortingDisabled} aria-label={`拖拽排序 ${group.name}`} className="touch-none cursor-grab active:cursor-grabbing"><GripVertical aria-hidden /></Button> : null}
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-base font-semibold">{group.name}</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {group.jql.trim() ? <Badge tone="info">{group.jiraProvider === "bosch" ? "Bosch Jira" : "Jira"}</Badge> : null}
            {group.meegleMql?.trim() && group.jiraProvider !== "bosch" ? <Badge tone="purple">飞书项目</Badge> : null}
            {!group.jql.trim() && !group.meegleMql?.trim() ? <Badge tone="warning">未配置查询</Badge> : null}
          </div>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-4 p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><FileCode2 className="size-4 shrink-0" aria-hidden /><span>{models.length} 个车型 · {filledPromptCount(group.prompts)} / 6 项提示词</span></div>
        <div className="flex min-h-7 flex-wrap gap-1.5">{models.length ? models.map((model) => <Badge key={model}>{model}</Badge>) : <span className="text-xs text-subtle-foreground">尚未配置车型文件</span>}</div>
        <dl className="space-y-3 text-xs">
          {group.jql.trim() ? <div><dt className="mb-1 font-medium text-muted-foreground">JQL</dt><dd className="line-clamp-3 break-all rounded-md bg-surface-2 p-2 font-mono leading-relaxed">{group.jql}</dd></div> : null}
          {group.meegleMql?.trim() && group.jiraProvider !== "bosch" ? <div><dt className="mb-1 font-medium text-muted-foreground">MQL</dt><dd className="line-clamp-3 break-all rounded-md bg-surface-2 p-2 font-mono leading-relaxed">{group.meegleMql}</dd></div> : null}
        </dl>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
        <span className="tabular text-[11px] text-subtle-foreground">更新于 {formatDateTime(group.updatedAt)}</span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit}>{canManage ? <Pencil aria-hidden /> : <Settings2 aria-hidden />}{canManage ? "编辑配置" : "查看配置"}</Button>
          {canManage ? <Button variant="ghost" size="icon" aria-label={`删除 ${group.name}`} onClick={onRemove}><Trash2 aria-hidden /></Button> : null}
        </div>
      </footer>
    </article>
  );
}
