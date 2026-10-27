"use client";

import { useEffect } from "react";
import { useSession } from "@/features/auth/session-store";
import { recoverPendingProcesses } from "@/features/tickets/services/process";
import { AUTO_CYCLE_POLL_MS } from "@/domain/rule-groups/auto-cycle";
import { recoverExpiredFilters } from "../filter-repository";
import { runDueAutoCycles } from "../auto-cycle-service";

/** 挂在应用外壳，路由切换不打断恢复或周期调度。 */
export function WorkflowRuntime() {
  const { user, ready } = useSession();
  useEffect(() => {
    if (!ready || !user) return;
    let recovering = false;
    const recover = async () => {
      if (recovering) return;
      recovering = true;
      try { await Promise.all([recoverExpiredFilters(), recoverPendingProcesses()]); }
      catch (error) { console.warn("任务恢复失败", error); }
      finally { recovering = false; }
    };
    const cycle = () => { void runDueAutoCycles().catch((error) => console.warn("自动周期执行失败", error)); };
    void recover().then(cycle);
    const recoveryTimer = setInterval(() => void recover(), 15_000);
    const cycleTimer = setInterval(cycle, AUTO_CYCLE_POLL_MS);
    return () => { clearInterval(recoveryTimer); clearInterval(cycleTimer); };
  }, [ready, user]);
  return null;
}
