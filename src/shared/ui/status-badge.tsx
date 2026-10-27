import * as React from "react";
import { AlertCircle, Ban, CheckCircle2, CircleDashed, Clock, Loader2, MinusCircle, TriangleAlert, XCircle } from "lucide-react";
import { Badge, type BadgeTone } from "./badge";

/**
 * 统一状态徽标：颜色 + 图标 + 文本（不只依赖颜色）。
 * 所有生命周期状态（任务、复核、回填、校验、同步…）都通过这里展示。
 */
export type StatusKind =
  | "idle"
  | "pending"
  | "running"
  | "processing"
  | "completed"
  | "succeeded"
  | "failed"
  | "expired"
  | "disabled"
  | "cancelled"
  | "approved"
  | "rejected"
  | "pass"
  | "fail"
  | "warning"
  | "unknown";

const STATUS_META: Record<StatusKind, { tone: BadgeTone; label: string; icon: React.ReactNode }> = {
  idle: { tone: "neutral", label: "未运行", icon: <CircleDashed aria-hidden /> },
  pending: { tone: "neutral", label: "待处理", icon: <Clock aria-hidden /> },
  running: { tone: "info", label: "运行中", icon: <Loader2 className="animate-spin" aria-hidden /> },
  processing: { tone: "info", label: "处理中", icon: <Loader2 className="animate-spin" aria-hidden /> },
  completed: { tone: "success", label: "已完成", icon: <CheckCircle2 aria-hidden /> },
  succeeded: { tone: "success", label: "成功", icon: <CheckCircle2 aria-hidden /> },
  failed: { tone: "danger", label: "失败", icon: <XCircle aria-hidden /> },
  expired: { tone: "warning", label: "已过期", icon: <AlertCircle aria-hidden /> },
  disabled: { tone: "neutral", label: "未配置", icon: <MinusCircle aria-hidden /> },
  cancelled: { tone: "neutral", label: "已取消", icon: <Ban aria-hidden /> },
  approved: { tone: "success", label: "已通过", icon: <CheckCircle2 aria-hidden /> },
  rejected: { tone: "danger", label: "已驳回", icon: <XCircle aria-hidden /> },
  pass: { tone: "success", label: "通过", icon: <CheckCircle2 aria-hidden /> },
  fail: { tone: "danger", label: "不通过", icon: <XCircle aria-hidden /> },
  warning: { tone: "warning", label: "警告", icon: <TriangleAlert aria-hidden /> },
  unknown: { tone: "neutral", label: "未知", icon: <CircleDashed aria-hidden /> },
};

export function StatusBadge({ status, label, className }: { status: StatusKind; label?: string; className?: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.unknown;
  return (
    <Badge tone={meta.tone} className={className}>
      {meta.icon}
      {label ?? meta.label}
    </Badge>
  );
}
