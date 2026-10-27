"use client";
import { useRef, useState } from 'react';
import { errorMessage } from '@/shared/lib/errors';
import type { ProgressHandler } from '@/shared/db/sync';

export function useDataOperation() {
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<unknown>();
  async function run(label: string, work: (progress: ProgressHandler) => Promise<unknown>) {
    if (lock.current) throw new Error('请等待当前操作完成');
    lock.current = true;
    setPending(true); setError(null); setReport(undefined); setMessages([label]);
    const progress = (message: string) => setMessages(previous => [...previous.slice(-49), message]);
    try {
      const result = await work(progress);
      setReport(result); progress('操作完成');
      return result;
    } catch (cause) {
      setError(errorMessage(cause)); throw cause;
    } finally { lock.current = false; setPending(false); }
  }
  function launch(label: string, work: (progress: ProgressHandler) => Promise<unknown>) {
    void run(label, work).catch(() => undefined);
  }
  return { pending, messages, error, report, run, launch };
}
export type DataOperation = ReturnType<typeof useDataOperation>;
