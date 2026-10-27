"use client";

import * as React from "react";
import { cn } from "@/shared/lib/cn";

export interface SegmentedOption<V extends string> {
  value: V;
  label: React.ReactNode;
  disabled?: boolean;
}

interface SegmentedControlProps<V extends string> {
  value: V;
  onValueChange: (value: V) => void;
  options: Array<SegmentedOption<V>>;
  "aria-label": string;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
}

/** 分段切换（少量互斥选项的筛选 / 范围切换），按钮组 + aria-pressed，键盘可达 */
export function SegmentedControl<V extends string>({
  value,
  onValueChange,
  options,
  size = "md",
  disabled,
  className,
  ...aria
}: SegmentedControlProps<V>) {
  return (
    <div
      role="group"
      aria-label={aria["aria-label"]}
      className={cn("inline-flex flex-wrap items-center gap-0.5 rounded-md border border-border bg-surface-2 p-0.5", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            disabled={disabled || option.disabled}
            onClick={() => onValueChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1 rounded-[5px] font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5",
              size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-3 text-sm",
              active ? "bg-surface text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
