"use client";

import { useEffect, useState } from "react";
import type { RuleGroup } from "@/domain/entities";
import { createLimiter, CLIENT_CONCURRENCY } from "@/shared/lib/concurrency";
import { toast } from "@/shared/ui/toast";
import { errorMessage } from "@/shared/lib/errors";
import { recoverExpiredFilters } from "./filter-repository";
import { runGroupFilter } from "./filter-service";

const schedule = createLimiter(CLIENT_CONCURRENCY);

export function useFilterAction(groups: RuleGroup[]) {
  const [running, setRunning] = useState(false);
  useEffect(() => { void recoverExpiredFilters().catch((error) => toast.error(errorMessage(error))); }, []);

  async function run(targets: RuleGroup[]) {
    if (running) return;
    setRunning(true);
    try {
      const results = await Promise.allSettled(targets.map((group) => schedule(() => runGroupFilter(group, groups))));
      const failed = results.filter((result) => result.status === "rejected" || (result.status === "fulfilled" && Object.values(result.value).some((state) => state.status === "failed" || state.status === "expired")));
      if (failed.length) toast.warning(`筛票结束，${failed.length} 个规则组存在失败来源，请查看各来源状态`);
      else toast.success("筛票完成");
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setRunning(false); }
  }
  return { run, running };
}
