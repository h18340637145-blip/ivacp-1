"use client";

import { useCallback, useId } from "react";
import { db } from "@/shared/db/database";
import { useLiveData } from "@/shared/hooks/use-live-data";
import { Switch } from "@/shared/ui/switch";
import { Input } from "@/shared/ui/input";
import { toast } from "@/shared/ui/toast";
import { errorMessage } from "@/shared/lib/errors";
import { formatDateTime } from "@/shared/lib/format";
import { toggleAutoCycleState, updateAutoCycleInterval } from "@/domain/rule-groups/auto-cycle";

export function AutoCycleControl({ groupId, canManage }: { groupId: string; canManage: boolean }) {
  const id = useId();
  const load = useCallback(() => db.autoCycles.get(groupId), [groupId]);
  const { data: state, error } = useLiveData(load);
  async function save(change: { active: boolean } | { interval: number }) {
    try {
      await db.transaction("rw", db.autoCycles, async () => {
        const current = await db.autoCycles.get(groupId);
        await db.autoCycles.put("active" in change ? toggleAutoCycleState(current, groupId, change.active) : updateAutoCycleInterval(current, groupId, change.interval));
      });
    } catch (error) { toast.error(errorMessage(error)); }
  }
  return <div className="space-y-2 rounded-lg border border-border p-3 text-xs">
    <div className="flex items-center justify-between gap-3"><label htmlFor={id} className="font-medium">自动筛票并分析</label><Switch id={id} checked={state?.isActive ?? false} disabled={!canManage || !!error} onCheckedChange={(active) => void save({ active })} /></div>
    <div className="flex items-center gap-2"><label htmlFor={`${id}-interval`}>间隔（分钟）</label><Input id={`${id}-interval`} aria-label="自动周期间隔（分钟）" type="number" min={5} step={1} defaultValue={state?.intervalMinutes ?? 30} key={state?.intervalMinutes ?? 30} disabled={!canManage} className="h-7 w-20" onBlur={(event) => { const interval = Number(event.target.value); if (interval !== (state?.intervalMinutes ?? 30)) void save({ interval }); }} /></div>
    <p className="text-muted-foreground">{state?.runToken ? "本轮正在执行" : state?.isActive ? `下次：${formatDateTime(state.nextRunAt)}` : "已关闭"} · 保持浏览器登录并打开页面时执行</p>
    {state?.lastError || error ? <p role="status" className="text-destructive">{state?.lastError ?? errorMessage(error)}</p> : null}
  </div>;
}
