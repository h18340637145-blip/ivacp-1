"use client";

import * as React from "react";
import { create } from "zustand";
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from "lucide-react";
import { cn } from "@/shared/lib/cn";

export type ToastTone = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  durationMs: number;
}

interface ToastState {
  items: ToastItem[];
  push: (item: Omit<ToastItem, "id" | "durationMs"> & { durationMs?: number }) => number;
  dismiss: (id: number) => void;
}

let seq = 0;

const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (item) => {
    const id = ++seq;
    const durationMs = item.durationMs ?? (item.tone === "error" ? 6000 : 3500);
    set((state) => ({ items: [...state.items.slice(-4), { ...item, id, durationMs }] }));
    return id;
  },
  dismiss: (id) => set((state) => ({ items: state.items.filter((t) => t.id !== id) })),
}));

/** 全局提示：toast.success("已保存") / toast.error("失败", { description }) */
export const toast = {
  show: (tone: ToastTone, title: string, options?: { description?: string; action?: ToastItem["action"]; durationMs?: number }) =>
    useToastStore.getState().push({ tone, title, ...options }),
  success: (title: string, options?: { description?: string; action?: ToastItem["action"] }) => toast.show("success", title, options),
  error: (title: string, options?: { description?: string; action?: ToastItem["action"] }) => toast.show("error", title, options),
  info: (title: string, options?: { description?: string; action?: ToastItem["action"] }) => toast.show("info", title, options),
  warning: (title: string, options?: { description?: string; action?: ToastItem["action"] }) => toast.show("warning", title, options),
  dismiss: (id: number) => useToastStore.getState().dismiss(id),
};

const toneIcon = {
  success: <CheckCircle2 className="size-4 text-success" aria-hidden />,
  error: <XCircle className="size-4 text-destructive" aria-hidden />,
  info: <Info className="size-4 text-info" aria-hidden />,
  warning: <TriangleAlert className="size-4 text-warning" aria-hidden />,
};

function ToastCard({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismiss);
  React.useEffect(() => {
    const timer = window.setTimeout(() => dismiss(item.id), item.durationMs);
    return () => window.clearTimeout(timer);
  }, [dismiss, item.id, item.durationMs]);
  return (
    <div className="pointer-events-auto flex w-80 items-start gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5 shadow-lg animate-in">
      <span className="mt-0.5">{toneIcon[item.tone]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{item.title}</p>
        {item.description ? <p className="mt-0.5 break-words text-xs text-muted-foreground">{item.description}</p> : null}
        {item.action ? (
          <button
            type="button"
            className="mt-1 text-xs font-medium text-primary hover:underline"
            onClick={() => {
              item.action?.onClick();
              dismiss(item.id);
            }}
          >
            {item.action.label}
          </button>
        ) : null}
      </div>
      <button type="button" onClick={() => dismiss(item.id)} className="rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="关闭提示">
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

/** 放在根布局一次；使用 aria-live 播报，不抢焦点 */
export function Toaster({ className }: { className?: string }) {
  const items = useToastStore((s) => s.items);
  return (
    <div aria-live="polite" aria-atomic="false" className={cn("pointer-events-none fixed bottom-4 right-4 z-[80] flex flex-col gap-2", className)}>
      {items.map((item) => <ToastCard key={item.id} item={item} />)}
    </div>
  );
}
