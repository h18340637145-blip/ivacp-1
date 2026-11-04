"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/cn";

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

interface SelectProps {
  id?: string;
  value: string | undefined;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
  size?: "sm" | "md";
}

/** 单选下拉（Radix Select 封装，键盘可达）；空值始终传 ""（受控并显示占位符），避免非受控/受控切换警告 */
export function Select({ id, value, onValueChange, options, placeholder = "请选择", disabled, className, size = "md", ...aria }: SelectProps) {
  return (
    <SelectPrimitive.Root value={value ?? ""} onValueChange={onValueChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        id={id}
        aria-label={aria["aria-label"]}
        className={cn(
          "inline-flex w-full items-center justify-between gap-2 rounded-md border border-input bg-surface px-3 text-sm text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 data-[placeholder]:text-subtle-foreground",
          size === "sm" ? "h-8 text-xs" : "h-9",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="z-[60] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-surface shadow-lg"
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="relative flex cursor-pointer select-none items-center rounded-sm py-1.5 pl-7 pr-2 text-sm text-foreground outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-50"
              >
                <SelectPrimitive.ItemIndicator className="absolute left-2 inline-flex">
                  <Check className="size-3.5 text-primary" aria-hidden />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
