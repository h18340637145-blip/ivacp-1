"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/shared/lib/errors";

export interface AsyncState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
}

/** 加载异步数据：统一 loading / error / reload，组件卸载后忽略过期结果 */
export function useAsync<T>(loader: () => Promise<T>): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const current = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const value = await loader();
      if (current === seq.current) setData(value);
    } catch (err) {
      if (current === seq.current) setError(errorMessage(err));
    } finally {
      if (current === seq.current) setLoading(false);
    }
  }, [loader]);

  useEffect(() => {
    let cancelled = false;
    // 将请求启动放到微任务中，清理时阻止过期加载，避免 effect 内同步级联更新。
    queueMicrotask(() => { if (!cancelled) void reload(); });
    return () => {
      cancelled = true;
      seq.current += 1;
    };
  }, [reload]);

  return { data, error, loading, reload };
}
