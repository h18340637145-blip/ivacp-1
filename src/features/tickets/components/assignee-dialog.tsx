"use client";

import { useState } from "react";
import type { RuleGroup, TicketSnapshot } from "@/domain/entities";
import type { MeegleWorkItemDetail } from "@/domain/meegle/work-item-detail";
import { fetchJiraTransitions, postJiraTransition } from "@/features/jira-workflow/services/jira-api";
import { apiFetch } from "@/shared/lib/api";
import { useAction } from "@/shared/hooks/use-action";
import { jiraProviderForSnapshot } from "@/domain/issue-source/jira-provider";
import { Button, Callout, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Select } from "@/shared/ui";

export function AssigneeDialog({ snapshot, group, onClose }: { snapshot: TicketSnapshot; group?: RuleGroup; onClose: () => void }) {
  const [users, setUsers] = useState<Array<{ value: string; label: string }>>([]);
  const [target, setTarget] = useState("");
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<MeegleWorkItemDetail | null>(null);
  const [receipt, setReceipt] = useState<string>();
  const identity = { projectKey: snapshot.projectKey ?? "", workItemTypeKey: snapshot.workItemTypeKey ?? "issue", workItemId: snapshot.ticketKey };
  const load = useAction(async () => {
    if (snapshot.source === "jira") {
      const data = await fetchJiraTransitions(snapshot.ruleGroupId, snapshot.ticketKey, jiraProviderForSnapshot(snapshot, group));
      setUsers(data.assigneeCandidates.map((user) => ({ value: user.name, label: `${user.displayName} · ${user.sourceLabels.join("、")}` })));
    } else {
      const data = await apiFetch<{ detail: MeegleWorkItemDetail | null; detailReceipt?: string }>(`/api/meegle/workitem?${new URLSearchParams(identity)}`);
      setDetail(data.detail); setReceipt(data.detailReceipt);
      if (!data.detail?.assigneeRole || !data.detailReceipt) throw new Error("工单经办人详情不完整，请刷新后重试");
    }
  });
  const search = useAction(async () => {
    if (!query.trim()) throw new Error("请输入姓名或邮箱");
    const data = await apiFetch<{ users: Array<{ key?: string; user_key?: string; name: string; display_name?: string; email?: string }> }>(`/api/meegle/users?${new URLSearchParams({ projectKey: identity.projectKey, q: query.trim() })}`);
    // 人员目录归一化字段以 key 为准，同时兼容 CLI 旧版 user_key。
    setUsers(data.users.flatMap((user) => {
      const key = user.key ?? user.user_key;
      return key ? [{ value: key, label: user.name || user.display_name || user.email || key }] : [];
    }));
  });
  const save = useAction(async () => {
    if (!target) throw new Error("请选择目标经办人");
    if (snapshot.source === "jira") await postJiraTransition({ ruleGroupId: snapshot.ruleGroupId, issueKey: snapshot.ticketKey, transitionId: "", targetUser: target, jiraProvider: jiraProviderForSnapshot(snapshot, group) });
    else {
      if (!detail?.assigneeRole || !receipt) throw new Error("请先刷新当前经办人");
      const claims = { action: "assignee", ...identity, targetUserKey: target, expectedCurrentUserKeys: detail.assigneeRole.members.map((member) => member.key), detailReceipt: receipt, assigneeRoleKey: detail.assigneeRole.key, updatedAt: detail.updatedAt };
      const { authorization } = await apiFetch<{ authorization: string }>("/api/meegle/authorize", { method: "POST", json: claims });
      await apiFetch("/api/meegle/assignee", { method: "POST", json: { ...claims, authorization } });
    }
    onClose();
  }, { success: "经办人已更新" });
  return <Dialog open onOpenChange={(open) => { if (!open && !save.pending) onClose(); }}><DialogContent hideClose={save.pending}><DialogHeader><DialogTitle>指派经办人</DialogTitle><DialogDescription>仅修改当前工单经办人，提交前请确认目标人员。</DialogDescription></DialogHeader><DialogBody className="space-y-4"><Button variant="outline" loading={load.pending} onClick={() => void load()}>{snapshot.source === "jira" ? "加载相关人员" : "刷新当前经办人"}</Button>{detail?.assigneeRole ? <Callout>当前经办人：{detail.assigneeRole.members.map((member) => member.name).join("、") || "未指派"}</Callout> : null}{snapshot.source === "meegle" ? <div className="flex items-end gap-2"><Field label="搜索姓名或邮箱" htmlFor="assignee-search" className="flex-1"><Input id="assignee-search" value={query} onChange={(e) => setQuery(e.target.value)} /></Field><Button variant="outline" loading={search.pending} onClick={() => void search()}>搜索</Button></div> : null}<Field label="目标经办人" htmlFor="assignee-target" required><Select id="assignee-target" value={target} onValueChange={setTarget} options={users} /></Field></DialogBody><DialogFooter><Button variant="ghost" onClick={onClose} disabled={save.pending}>取消</Button><Button variant="primary" loading={save.pending} disabled={!target} onClick={() => void save()}>确认指派</Button></DialogFooter></DialogContent></Dialog>;
}
