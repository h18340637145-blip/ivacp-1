"use client";

import { useState } from "react";
import type { RuleGroup, TicketSnapshot } from "@/domain/entities";
import { loadRuleGroupFilters } from "@/features/workflow/filter-service";
import { processTicket } from "./services/process";
import { errorMessage } from "@/shared/lib/errors";
import { toast } from "@/shared/ui/toast";

export function useProcessAction() {
  const [running, setRunning] = useState(false);


  async function run(groups: RuleGroup[]) {
    if (running) return;
    setRunning(true);
    try {
      const settled = await Promise.allSettled(groups.map(async (group) => {
        const filters = await loadRuleGroupFilters(group);
        const tasks = await Promise.allSettled([...filters.snapshots.jira, ...filters.snapshots.meegle].map((snapshot) => processTicket(snapshot, group)));
        const failed = tasks.find((task) => task.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
      }));
      const rejected = settled.find((value) => value.status === "rejected");
      if (rejected?.status === "rejected") throw rejected.reason;
      toast.info("本轮分析结束，请查看各工单结果或失败原因");
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setRunning(false); }
  }
  return { run, running };
}

export function ticketHref(snapshot: TicketSnapshot) {
  const query = new URLSearchParams({ group: snapshot.ruleGroupId });
  if (snapshot.projectKey) query.set("project", snapshot.projectKey);
  if (snapshot.workItemTypeKey) query.set("type", snapshot.workItemTypeKey);
  return `/tickets/${snapshot.source}/${encodeURIComponent(snapshot.ticketKey)}?${query}`;
}
