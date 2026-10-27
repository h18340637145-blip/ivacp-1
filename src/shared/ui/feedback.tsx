import * as React from "react";
import { AlertTriangle, Inbox, Loader2, RotateCw } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { Button } from "./button";

export function Spinner({ className, label = "加载中" }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-2 text-sm text-muted-foreground", className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span>{label}</span>
    </span>
  );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("animate-pulse-soft rounded-md bg-surface-3", className)} {...props} />;
}

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/** 空状态：说明 + 下一步操作 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center", className)}>
      <div className="text-subtle-foreground [&_svg]:size-8">{icon ?? <Inbox aria-hidden />}</div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-md text-xs text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

/** 错误状态：原因 + 重试入口 */
export function ErrorState({ title = "加载失败", error, onRetry, className }: ErrorStateProps) {
  const message = error instanceof Error ? error.message : String(error ?? "未知错误");
  return (
    <div role="alert" className={cn("flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive-soft px-4 py-3", className)}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-destructive">{title}</p>
        <p className="mt-0.5 break-words text-xs text-foreground/80">{message}</p>
      </div>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCw aria-hidden />
          重试
        </Button>
      ) : null}
    </div>
  );
}

/** 行内提示条 */
export function Callout({ tone = "info", title, children, className }: { tone?: "info" | "warning" | "danger" | "success"; title?: string; children?: React.ReactNode; className?: string }) {
  const toneClass = {
    info: "border-info/30 bg-info-soft text-info",
    warning: "border-warning/30 bg-warning-soft text-warning",
    danger: "border-destructive/30 bg-destructive-soft text-destructive",
    success: "border-success/30 bg-success-soft text-success",
  }[tone];
  return (
    <div className={cn("rounded-md border px-3 py-2 text-xs", toneClass, className)}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className="text-foreground/85">{children}</div> : null}
    </div>
  );
}
