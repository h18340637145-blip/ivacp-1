"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/shared/lib/cn";

export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn("text-xs font-medium text-foreground", className)} {...props} />
));
Label.displayName = "Label";

interface FieldProps {
  label: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  /** 常驻帮助文本，显示在控件下方 */
  hint?: React.ReactNode;
  /** 校验错误，显示在控件下方并通过 role=alert 播报 */
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/** 表单字段：可见标签 + 控件 + 帮助/错误文本 */
export function Field({ label, htmlFor, required, hint, error, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="ml-0.5 text-destructive" aria-hidden>*</span> : null}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
