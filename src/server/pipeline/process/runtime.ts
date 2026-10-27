import { AsyncLocalStorage } from "node:async_hooks";
import type { AnalysisRunHandle } from "@/server/artifacts/analysis-run-registry";

type PendingChild = { kill(signal: NodeJS.Signals): unknown; closed: Promise<void> };
type RuntimeContext = { handle?: AnalysisRunHandle; signal?: AbortSignal; children: Set<PendingChild> };
const storage = new AsyncLocalStorage<RuntimeContext>();

export function withAnalysisRun<T>(handle: AnalysisRunHandle | undefined, callback: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return storage.run({ handle, signal: signal ?? handle?.signal, children: new Set() }, async () => {
    try { return await callback(); }
    catch (error) { await terminatePipelineChildren(); throw error; }
  });
}
export function pipelineSignal(): AbortSignal | undefined { return storage.getStore()?.signal; }
export function throwIfPipelineCancelled(): void { pipelineSignal()?.throwIfAborted(); }

/** 成功发布与显式停止共用 registry 的终态门禁。 */
export async function publishPipelineSuccess(publish: () => Promise<void>): Promise<void> {
  throwIfPipelineCancelled();
  const handle = storage.getStore()?.handle;
  if (handle) await handle.commitSuccess(publish);
  else await publish();
}

/** 失败必须先收拢子进程，再释放运行身份，防止残留进程继续写产物。 */
export async function terminatePipelineChildren(): Promise<void> {
  const children = [...(storage.getStore()?.children ?? [])];
  await Promise.all(children.map(async (child) => {
    try { child.kill("SIGTERM"); } catch { /* 下次升级为强制终止。 */ }
    const escalation = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* 等待 close 确认退出。 */ } }, 1_000);
    try { await child.closed; } finally { clearTimeout(escalation); }
  }));
}

export function trackPipelineChild(child: { pid?: number; kill(signal?: NodeJS.Signals | number): unknown; once(event: "close", callback: () => void): unknown }): void {
  const context = storage.getStore();
  if (!context) return;
  // Unix 子进程由 detached 创建独立进程组，同时终止 Node 包装器及 Python / Chromium 后代。
  const tracked = {
    kill(signal: NodeJS.Signals = "SIGTERM") {
      if (process.platform !== "win32" && child.pid) {
        try { process.kill(-child.pid, signal); return true; }
        catch { /* 子进程可能已退出，仍尝试直接终止。 */ }
      }
      return child.kill(signal);
    },
  };
  let resolveClosed!: () => void;
  const pending: PendingChild = { kill: tracked.kill, closed: new Promise<void>((resolve) => { resolveClosed = resolve; }) };
  context.children.add(pending);
  const cleanup: { release?: () => void } = {};
  const abort = () => { tracked.kill("SIGTERM"); };
  child.once("close", () => {
    cleanup.release?.(); context.signal?.removeEventListener("abort", abort);
    context.children.delete(pending); resolveClosed();
  });
  cleanup.release = context.handle?.trackChild(tracked);
  if (context.signal?.aborted) abort();
  else context.signal?.addEventListener("abort", abort, { once: true });
}
