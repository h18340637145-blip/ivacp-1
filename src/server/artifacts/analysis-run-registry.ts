export interface AnalysisRunIdentity {
  runId: string;
  source: "meegle";
  issueKey: string;
}

type TrackedChild = {
  kill(signal?: NodeJS.Signals | number): unknown;
};

export interface AnalysisRunHandle {
  readonly signal: AbortSignal;
  readonly identity: AnalysisRunIdentity;
  setLogRoot(logRoot: string): void;
  trackChild(child: TrackedChild): () => void;
  throwIfCancelled(): void;
  commitSuccess(publish: () => Promise<void>): Promise<void>;
  dispose(): void;
}

export interface StopAnalysisRunResult {
  status: "stopped";
  active: boolean;
  alreadyStopped: boolean;
  logRoot?: string;
  terminationFailures?: number;
}

export class AnalysisRunCompletedError extends Error {
  constructor() { super("分析运行已完成，无法取消"); this.name = "AnalysisRunCompletedError"; }
}

type ActiveRun = {
  state: "running" | "committing" | "completed";
  commitSettled?: Promise<void>;
  controller: AbortController;
  identity: AnalysisRunIdentity;
  children: Set<TrackedChild>;
  failedTerminationChildren: Set<TrackedChild>;
  logRoot?: string;
};

type StoppedRun = {
  identity: AnalysisRunIdentity;
  logRoot?: string;
  terminationFailures: number;
  failedTerminationChildren: Set<TrackedChild>;
};

type AnalysisRunRegistry = {
  activeRuns: Map<string, ActiveRun>;
  stoppedRuns: Map<string, StoppedRun>;
  completedRuns: Map<string, AnalysisRunIdentity>;
};

const registryKey = Symbol.for("jira-analysis.analysis-run-registry");

function getRegistry(): AnalysisRunRegistry {
  const registryGlobal = globalThis as typeof globalThis & {
    [key: symbol]: AnalysisRunRegistry | undefined;
  };
  const existingRegistry = registryGlobal[registryKey];

  if (existingRegistry) {
    existingRegistry.completedRuns ??= new Map();
    return existingRegistry;
  }

  const registry: AnalysisRunRegistry = {
    activeRuns: new Map(),
    stoppedRuns: new Map(),
    completedRuns: new Map(),
  };
  registryGlobal[registryKey] = registry;
  return registry;
}

function identitiesMatch(left: AnalysisRunIdentity, right: AnalysisRunIdentity) {
  return left.source === right.source && left.issueKey === right.issueKey;
}

function assertMatchingIdentity(expected: AnalysisRunIdentity, actual: AnalysisRunIdentity) {
  if (!identitiesMatch(expected, actual)) {
    throw new Error(`分析运行身份不匹配: ${actual.runId}`);
  }
}

function stopResult(
  run: { logRoot?: string; terminationFailures?: number },
  active: boolean,
  alreadyStopped: boolean,
): StopAnalysisRunResult {
  return {
    status: "stopped",
    active,
    alreadyStopped,
    ...(run.logRoot === undefined ? {} : { logRoot: run.logRoot }),
    ...(run.terminationFailures ? { terminationFailures: run.terminationFailures } : {}),
  };
}

function terminateChild(child: TrackedChild) {
  try {
    return child.kill("SIGTERM") !== false;
  } catch {
    // A failed child-process kill must not prevent the remaining children from stopping.
    return false;
  }
}

function recordStoppedRun(registry: AnalysisRunRegistry, activeRun: ActiveRun) {
  registry.stoppedRuns.set(activeRun.identity.runId, {
    identity: activeRun.identity,
    logRoot: activeRun.logRoot,
    terminationFailures: activeRun.failedTerminationChildren.size,
    failedTerminationChildren: new Set(activeRun.failedTerminationChildren),
  });
}

function activeStopResult(activeRun: ActiveRun, alreadyStopped: boolean) {
  return stopResult(
    {
      logRoot: activeRun.logRoot,
      terminationFailures: activeRun.failedTerminationChildren.size,
    },
    true,
    alreadyStopped,
  );
}

function terminateChildren(children: Iterable<TrackedChild>, failures: Set<TrackedChild>) {
  for (const child of children) {
    if (terminateChild(child)) {
      failures.delete(child);
    } else {
      failures.add(child);
    }
  }
}

export function registerAnalysisRun(identity: AnalysisRunIdentity): AnalysisRunHandle {
  const registry = getRegistry();
  if (registry.activeRuns.has(identity.runId) || registry.stoppedRuns.has(identity.runId) || registry.completedRuns.has(identity.runId)) {
    throw new Error(`分析运行 runId 已登记: ${identity.runId}`);
  }

  const immutableIdentity = Object.freeze({ ...identity });
  const activeRun: ActiveRun = {
    state: "running",
    controller: new AbortController(),
    identity: immutableIdentity,
    children: new Set(),
    failedTerminationChildren: new Set(),
  };
  registry.activeRuns.set(immutableIdentity.runId, activeRun);

  return {
    signal: activeRun.controller.signal,
    identity: immutableIdentity,
    setLogRoot(logRoot) {
      activeRun.logRoot = logRoot;
    },
    trackChild(child) {
      if (activeRun.controller.signal.aborted) {
        terminateChildren([child], activeRun.failedTerminationChildren);
        recordStoppedRun(registry, activeRun);
        return () => {};
      }
      activeRun.children.add(child);
      return () => activeRun.children.delete(child);
    },
    throwIfCancelled() {
      activeRun.controller.signal.throwIfAborted();
    },
    async commitSuccess(publish) {
      activeRun.controller.signal.throwIfAborted();
      if (activeRun.state !== "running") throw new Error("分析运行正在提交或已经完成");
      activeRun.state = "committing";
      let release!: () => void;
      activeRun.commitSettled = new Promise<void>((resolve) => { release = resolve; });
      try {
        await publish();
        activeRun.state = "completed";
        registry.completedRuns.set(identity.runId, immutableIdentity);
      } catch (error) {
        activeRun.state = "running";
        throw error;
      } finally {
        activeRun.commitSettled = undefined;
        release();
      }
    },
    dispose() {
      registry.activeRuns.delete(immutableIdentity.runId);
    },
  };
}

export function requestAnalysisRunStop(identity: AnalysisRunIdentity): StopAnalysisRunResult {
  const registry = getRegistry();
  const completed = registry.completedRuns.get(identity.runId);
  if (completed) { assertMatchingIdentity(completed, identity); throw new AnalysisRunCompletedError(); }
  const activeRun = registry.activeRuns.get(identity.runId);

  if (activeRun) {
    assertMatchingIdentity(activeRun.identity, identity);
    if (activeRun.state === "committing") throw new Error("分析运行正在提交最终结果");
    if (activeRun.controller.signal.aborted) {
      terminateChildren([...activeRun.failedTerminationChildren], activeRun.failedTerminationChildren);
      recordStoppedRun(registry, activeRun);
      return activeStopResult(activeRun, true);
    }

    activeRun.controller.abort();
    terminateChildren(activeRun.children, activeRun.failedTerminationChildren);
    recordStoppedRun(registry, activeRun);
    return activeStopResult(activeRun, false);
  }

  const stoppedRun = registry.stoppedRuns.get(identity.runId);
  if (stoppedRun) {
    assertMatchingIdentity(stoppedRun.identity, identity);
    terminateChildren([...stoppedRun.failedTerminationChildren], stoppedRun.failedTerminationChildren);
    stoppedRun.terminationFailures = stoppedRun.failedTerminationChildren.size;
    return stopResult(stoppedRun, false, true);
  }

  throw new Error(`未找到分析运行: ${identity.runId}`);
}

/** 提交占用终态门禁时，停止请求等待其成功或失败后再作出终态决定。 */
export async function requestAnalysisRunStopAfterCommit(identity: AnalysisRunIdentity): Promise<StopAnalysisRunResult> {
  for (;;) {
    const active = getRegistry().activeRuns.get(identity.runId);
    if (active) assertMatchingIdentity(active.identity, identity);
    if (!active?.commitSettled) return requestAnalysisRunStop(identity);
    await active.commitSettled;
  }
}

export function resetAnalysisRunRegistryForTests() {
  const registry = getRegistry();
  registry.activeRuns.clear();
  registry.stoppedRuns.clear();
  registry.completedRuns.clear();
}
