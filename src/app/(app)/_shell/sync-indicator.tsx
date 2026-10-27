"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CloudCheck, CloudOff, CloudUpload, RefreshCw } from "lucide-react";
import { getAutoSyncState, installAutoSync, subscribeAutoSync, type AutoSyncState } from "@/shared/db/sync";
import { formatRelative } from "@/shared/lib/format";
import { Tooltip } from "@/shared/ui/tooltip";
import { cn } from "@/shared/lib/cn";

/** 顶栏服务端同步状态；首次挂载时安装自动增量同步 */
export function SyncIndicator() {
  const [state, setState] = useState<AutoSyncState>(getAutoSyncState);

  useEffect(() => {
    const unsubscribe = subscribeAutoSync(setState);
    void installAutoSync();
    return unsubscribe;
  }, []);

  let Icon = CloudOff;
  let label = "未启用服务端同步";
  let tone = "text-subtle-foreground";
  if (state.enabled) {
    if (state.lastError) {
      Icon = CloudOff;
      label = `同步失败：${state.lastError}`;
      tone = "text-destructive";
    } else if (state.syncing) {
      Icon = RefreshCw;
      label = "正在同步到服务器";
      tone = "text-info";
    } else if (state.pending > 0) {
      Icon = CloudUpload;
      label = `${state.pending} 条记录待同步`;
      tone = "text-warning";
    } else {
      Icon = CloudCheck;
      label = `已同步${state.lastSyncAt ? `（${formatRelative(state.lastSyncAt)}）` : ""}`;
      tone = "text-success";
    }
  }

  return (
    <Tooltip content={label}>
      <Link
        href="/settings/data"
        className="inline-flex size-9 items-center justify-center rounded-md hover:bg-surface-2"
        aria-label={label}
      >
        <Icon className={cn("size-4", tone, state.syncing && "animate-spin motion-reduce:animate-none")} aria-hidden />
      </Link>
    </Tooltip>
  );
}
