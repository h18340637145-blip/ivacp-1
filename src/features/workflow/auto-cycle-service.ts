"use client";

import { nanoid } from "nanoid";
import { db } from "@/shared/db/database";
import { errorMessage } from "@/shared/lib/errors";
import { isAutoCycleDue, nextAutoCycleRunDate } from "@/domain/rule-groups/auto-cycle";
import { getProcessSources } from "@/domain/issue-source/contracts";
import { runGroupFilter, loadRuleGroupFilters } from "./filter-service";
import { processTicket } from "@/features/tickets/services/process";

const LEASE_MS = 2 * 60 * 60_000;

/** 数据库租约协调标签页；网络操作全部在事务外执行。 */
export async function runDueAutoCycles(): Promise<void> {
  const groups = await db.ruleGroups.toArray();
  await Promise.all(groups.map(async (group) => {
    const token = nanoid();
    const claimed = await db.transaction("rw", db.autoCycles, db.filterRuns, db.processTasks, async () => {
      const state = await db.autoCycles.get(group.id);
      if (!isAutoCycleDue(state) || !state) return false;
      if (state.runToken && state.runningSince && Date.now() - +new Date(state.runningSince) < LEASE_MS) return false;
      const busy = (await db.processTasks.where("ruleGroupId").equals(group.id).toArray()).some((row) => row.status === "running")
        || (await db.filterRuns.where("ruleGroupId").equals(group.id).toArray()).some((row) => row.status === "running");
      if (busy) return false;
      await db.autoCycles.update(group.id, { runToken: token, runningSince: new Date(), lastRunAt: new Date(), lastError: undefined });
      return true;
    });
    if (!claimed) return;
    let failure: string | undefined;
    try {
      const summary = await runGroupFilter(group, groups);
      const state = await db.autoCycles.get(group.id);
      if (!state?.isActive || state.runToken !== token) return;
      const filters = await loadRuleGroupFilters(group);
      const outcomes = await Promise.allSettled(getProcessSources(summary).flatMap((source) => filters.snapshots[source]).map(async (snapshot) => {
        const current = await db.autoCycles.get(group.id);
        if (current?.isActive && current.runToken === token) await processTicket(snapshot, group, { shouldStart: async () => {
          const latest = await db.autoCycles.get(group.id);
          return latest?.isActive === true && latest.runToken === token;
        } });
      }));
      const rejected = outcomes.find((outcome) => outcome.status === "rejected");
      if (rejected?.status === "rejected") failure = errorMessage(rejected.reason);
      else if (Object.values(summary).some((source) => source.configured && source.status === "failed")) failure = "部分来源筛票失败，请查看来源状态";
    } catch (error) { failure = errorMessage(error); }
    finally {
      await db.transaction("rw", db.autoCycles, async () => {
        const state = await db.autoCycles.get(group.id);
        if (state?.runToken !== token) return;
        await db.autoCycles.update(group.id, { runToken: undefined, runningSince: undefined, lastError: failure, nextRunAt: nextAutoCycleRunDate(state.intervalMinutes) });
      });
    }
  }));
}
