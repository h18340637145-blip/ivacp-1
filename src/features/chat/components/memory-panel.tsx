"use client";

import { useCallback, useEffect, useState } from "react";
import { Brain, Pin, PinOff, Plus, Trash2 } from "lucide-react";
import type { MemoryRecord } from "@/domain/entities";
import { errorMessage } from "@/shared/lib/errors";
import { formatDate } from "@/shared/lib/format";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Input } from "@/shared/ui/input";
import { EmptyState, ErrorState, Skeleton } from "@/shared/ui/feedback";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { toast } from "@/shared/ui/toast";
import {
  MAX_MEMORY_LENGTH,
  addManualMemory,
  deleteMemory,
  listMemories,
  sortMemories,
  toggleMemoryPin,
} from "../lib/memory-service";

const TYPE_LABEL: Record<MemoryRecord["type"], string> = {
  fact: "事实",
  preference: "偏好",
  episode: "事件",
  manual: "手动",
};

interface MemoryPanelProps {
  userId: string;
  /** 外部（对话后台抽取）变化时递增，触发刷新 */
  version: number;
}

export function MemoryPanel({ userId, version }: MemoryPanelProps) {
  const [items, setItems] = useState<MemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<MemoryRecord | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(sortMemories(await listMemories(userId)));
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; };
  }, [load, version]);

  const add = async () => {
    const content = text.trim();
    if (!content || adding) return;
    setAdding(true);
    try {
      const { embedded } = await addManualMemory(userId, content);
      setText("");
      await load();
      if (embedded) toast.success("已添加记忆");
      else toast.warning("已添加记忆", { description: "向量服务不可用，该记忆仅按关键词召回" });
    } catch (error) {
      toast.error(`添加失败：${errorMessage(error)}`);
    } finally {
      setAdding(false);
    }
  };

  const togglePin = async (m: MemoryRecord) => {
    try {
      await toggleMemoryPin(m);
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <Input
          aria-label="手动添加记忆"
          placeholder="手动添加一条记忆…"
          maxLength={MAX_MEMORY_LENGTH}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" variant="primary" size="icon" aria-label="添加记忆" loading={adding} disabled={!text.trim()}>
          <Plus aria-hidden />
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        对话结束后会自动抽取与你相关的长期记忆；置顶的记忆召回加权且不会被自动遗忘。仅当前登录用户可见。
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : loadError ? (
          <ErrorState error={loadError} onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState icon={<Brain aria-hidden />} title="暂无记忆" description="与助手对话后会自动积累，也可以手动添加。" />
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((m) => (
              <li
                key={m.id}
                className={cn(
                  "flex items-start gap-2 rounded-md border px-3 py-2",
                  m.pinned ? "border-primary/40 bg-primary-soft" : "border-border bg-surface",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm text-foreground">{m.content}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <Badge tone={m.type === "manual" ? "purple" : "neutral"}>{TYPE_LABEL[m.type]}</Badge>
                    <span className="tabular-nums">重要度 {m.importance.toFixed(1)}</span>
                    <span>{formatDate(m.createdAt)}</span>
                    {m.pinned ? <span className="text-primary">已置顶</span> : null}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={m.pinned ? "取消置顶" : "置顶"}
                  aria-pressed={!!m.pinned}
                  onClick={() => void togglePin(m)}
                >
                  {m.pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="删除记忆" onClick={() => setPendingDelete(m)}>
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="删除记忆"
        description={pendingDelete ? `确定删除「${pendingDelete.content.slice(0, 60)}」吗？` : undefined}
        confirmText="删除"
        destructive
        onConfirm={async () => {
          if (!pendingDelete) return;
          await deleteMemory(pendingDelete.id);
          await load();
        }}
      />
    </div>
  );
}
