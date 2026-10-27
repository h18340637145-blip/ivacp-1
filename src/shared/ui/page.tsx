import * as React from "react";
import { cn } from "@/shared/lib/cn";

/** 页面内容容器：统一最大宽度与响应式边距。全宽工作台（看板、终端）传 width="full"。 */
export function Page({
  className,
  width = "default",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { width?: "default" | "narrow" | "full" }) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 py-6 sm:px-6 lg:px-8",
        width === "default" && "max-w-7xl",
        width === "narrow" && "max-w-4xl",
        className,
      )}
      {...props}
    />
  );
}
