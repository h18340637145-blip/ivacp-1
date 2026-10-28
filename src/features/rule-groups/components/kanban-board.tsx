"use client";

import { useCallback, useState } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Download, Filter, LayoutGrid, Play, Plus, Search, Upload } from "lucide-react";
import { DirectJiraAnalysis } from "@/features/direct-analysis/components/direct-jira-analysis";
import { useProcessAction } from "@/features/tickets/use-process-action";
import { createRuleGroupSourceSummary, getConfiguredSources } from "@/domain/issue-source/contracts";
import { loadRuleGroupFilters } from "@/features/workflow/filter-service";
import { useFilterAction } from "@/features/workflow/use-filter-action";
import { useLiveData } from "@/shared/hooks/use-live-data";
import type { RuleGroup } from "@/domain/entities";
import { useSession } from "@/features/auth/session-store";
import { errorMessage } from "@/shared/lib/errors";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Input, Page, PageHeader, Select, Spinner, Stat, toast } from "@/shared/ui";
import { useRuleGroups } from "../store";
import { ImportDialog } from "./import-dialog";
import { RuleGroupCard } from "./rule-group-card";
import { RuleGroupDialog } from "./rule-group-dialog";

type Editor = { group?: RuleGroup; bosch?: boolean };

export function KanbanBoard() {
  const state = useRuleGroups();
  const { can, ready } = useSession();
  const canManage = ready && can("admin");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [removing, setRemoving] = useState<RuleGroup | null>(null);
  const [sorting, setSorting] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const groups = state.ruleGroups;
  const filter = useFilterAction(groups);
  const process = useProcessAction();
  const summaries = useLiveData(useCallback(async () => Object.fromEntries(await Promise.all(groups.map(async (group) => [group.id, (await loadRuleGroupFilters(group)).summary] as const))), [groups]));
  const needle = query.trim().toLowerCase();
  const visible = groups.filter((group) => (
    !needle || [group.name, group.jql, group.meegleMql ?? "", ...Object.keys(group.model_to_files ?? {})].some((value) => value.toLowerCase().includes(needle))
  ) && (source === "all" || (source === "jira" && Boolean(group.jql.trim())) || (source === "meegle" && group.jiraProvider !== "bosch" && Boolean(group.meegleMql?.trim()))));
  const sortingDisabled = !canManage || sorting || Boolean(needle) || source !== "all";

  async function reorder({ active, over }: DragEndEvent) {
    if (sortingDisabled || !over || active.id === over.id) return;
    setSorting(true);
    try { await state.reorder(String(active.id), String(over.id)); }
    catch (error) { toast.error(`排序保存失败：${errorMessage(error)}`); }
    finally { setSorting(false); }
  }

  async function remove() {
    if (!removing) return;
    await state.remove(removing.id); toast.success("规则组已删除"); setRemoving(null);
  }

  return (
    <Page width="full" className="space-y-5">
      <PageHeader title="规则组看板" description="管理不同项目的工单查询、车型文件与分析提示词。" meta={<Badge tone="success">本地保存</Badge>}
        actions={<>
          <Button variant="outline" disabled={!groups.some((group) => getConfiguredSources(group).length)} loading={filter.running} onClick={() => void filter.run(groups.filter((group) => getConfiguredSources(group).length))}><Filter aria-hidden />一键筛选</Button>
          <Button variant="outline" disabled={!groups.length} loading={process.running} onClick={() => void process.run(groups)}><Play aria-hidden />一键处理</Button>
          <Button variant="outline" disabled={!state.loaded || !!state.error || !groups.length} onClick={state.exportFile}><Download aria-hidden />导出规则组</Button>
          {canManage ? <><Button variant="outline" onClick={() => setImportOpen(true)}><Upload aria-hidden />导入</Button><Button variant="outline" onClick={() => setEditor({ bosch: true })}>新建 Bosch Jira 规则组</Button><Button variant="primary" onClick={() => setEditor({})}><Plus aria-hidden />新建规则组</Button></> : null}
        </>} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="规则组" value={groups.length} icon={<LayoutGrid aria-hidden />} />
        <Stat label="已配置 Jira" value={groups.filter((group) => group.jql.trim()).length} />
        <Stat label="已配置飞书项目" value={groups.filter((group) => group.jiraProvider !== "bosch" && group.meegleMql?.trim()).length} />
      </div>
      <DirectJiraAnalysis disabled={!state.loaded || !!state.error || !groups.length} />
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full min-w-0 flex-none sm:w-auto sm:max-w-md sm:flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden /><Input aria-label="搜索规则组" placeholder="搜索规则组、车型或查询语句" className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <Select aria-label="来源筛选" className="w-40" value={source} onValueChange={setSource} options={[{ value: "all", label: "全部来源" }, { value: "jira", label: "Jira" }, { value: "meegle", label: "飞书项目" }]} />
        {canManage ? <p className="text-xs text-muted-foreground">{sorting ? "正在保存排序…" : needle || source !== "all" ? "清除筛选后可拖拽排序" : "拖动卡片把手排序，也可按空格和方向键操作"}</p> : null}
      </div>
      {state.error ? <ErrorState title="规则组加载失败" error={state.error} onRetry={() => void state.load()} /> : !state.loaded ? <Spinner label="正在读取规则组" /> : !groups.length ? (
        <EmptyState icon={<LayoutGrid aria-hidden />} title="创建第一个规则组" description={canManage ? "新建项目配置，或导入原系统导出的规则组 JSON 文件。" : "请联系管理员创建规则组或导入项目配置。"} />
      ) : !visible.length ? <EmptyState title="没有匹配的规则组" description="试试其他关键词，或清除筛选条件。" action={<Button onClick={() => { setQuery(""); setSource("all"); }}>清除筛选</Button>} /> : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void reorder(event)} accessibility={{ screenReaderInstructions: { draggable: "按空格拿起卡片，使用方向键移动，再按空格放下；按 Escape 取消。" } }}>
          <SortableContext items={visible.map((group) => group.id)} strategy={rectSortingStrategy}>
            <div className="grid items-stretch gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {visible.map((group) => <RuleGroupCard key={group.id} group={group} canManage={canManage} sortingDisabled={sortingDisabled} onEdit={() => setEditor({ group })} onRemove={() => setRemoving(group)} onFilter={() => void filter.run([group])} summary={summaries.data?.[group.id] ?? createRuleGroupSourceSummary(group)} />)}
            </div>
          </SortableContext>
        </DndContext>
      )}
      {editor ? <RuleGroupDialog key={editor.group?.id ?? String(editor.bosch)} {...editor} readOnly={!canManage} onClose={() => setEditor(null)} /> : null}
      {importOpen && canManage ? <ImportDialog onClose={() => setImportOpen(false)} /> : null}
      {removing ? <ConfirmDialog key={removing.id} open onOpenChange={(open) => { if (!open) setRemoving(null); }} title={`删除「${removing.name}」？`} description="将删除规则组配置，已有分析结果与历史保留。" confirmText="删除规则组" destructive onConfirm={remove} /> : null}
    </Page>
  );
}
