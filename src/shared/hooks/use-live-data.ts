"use client";

import { liveQuery } from "dexie";
import { useEffect, useReducer, useState } from "react";

/** 订阅查询实际读取的 IndexedDB 表；同页写入、恢复和其他标签页变化都会重新读取。 */
export function useLiveData<T>(loader: () => Promise<T>) {
  const [version, reload] = useReducer((value: number) => value + 1, 0);
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({ loading: true });
  useEffect(() => {
    const subscription = liveQuery(loader).subscribe({
      next: (data) => setState({ data, loading: false }),
      error: (error) => setState({ error, loading: false }),
    });
    return () => subscription.unsubscribe();
  }, [loader, version]);
  return { ...state, reload };
}
