import * as React from "react";
import { cn } from "@/shared/lib/cn";

interface StatProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: "default" | "primary" | "warning" | "danger" | "info";
  className?: string;
}

/** KPI 指标卡：数字使用等宽数字，避免刷新抖动 */
export function Stat({ label, value, hint, icon, tone = "default", className }: StatProps) {
  const toneClass = {
    default: "text-foreground",
    primary: "text-primary",
    warning: "text-warning",
    danger: "text-destructive",
    info: "text-info",
  }[tone];
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2.5", className)}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className={cn("tabular text-xl font-semibold leading-none", toneClass)}>{value}</div>
      {hint ? <div className="truncate text-xs text-subtle-foreground">{hint}</div> : null}
    </div>
  );
}
