"use client";

import { useCallback, useState } from "react";
import { toast } from "@/shared/ui/toast";
import { errorMessage } from "@/shared/lib/errors";

/**
 * 包装一次用户操作：自动 pending 状态、成功 / 失败 toast。
 * 用法：const save = useAction(async () => {...}, { success: "已保存" });
 */
export function useAction<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>,
  options: { success?: string | ((result: R) => string); error?: string } = {},
) {
  const [pending, setPending] = useState(false);
  const run = useCallback(
    async (...args: Args): Promise<R | undefined> => {
      setPending(true);
      try {
        const result = await fn(...args);
        if (options.success) toast.success(typeof options.success === "function" ? options.success(result) : options.success);
        return result;
      } catch (error) {
        toast.error(options.error ? `${options.error}：${errorMessage(error)}` : errorMessage(error));
        return undefined;
      } finally {
        setPending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn],
  );
  return Object.assign(run, { pending });
}
