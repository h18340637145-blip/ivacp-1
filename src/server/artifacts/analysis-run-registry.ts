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
  dispose(): void;
}

export interface StopAnalysisRunResult {
  status: "stopped";
  active: boolean;
  alreadyStopped: boolean;
  logRoot?: string;
  terminationFailures?: number;
}

type ActiveRun = {
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
};

const registryKey = Symbol.for("jira-analysis.analysis-run-registry");

function getRegistry(): AnalysisRunRegistry {
  const registryGlobal = globalThis as typeof globalThis & {
    [key: symbol]: AnalysisRunRegistry | undefined;
  };
  const existingRegistry = registryGlobal[registryKey];

  if (existingRegistry) {
    return existingRegistry;
  }

  const registry: AnalysisRunRegistry = {
    activeRuns: new Map(),
    stoppedRuns: new Map(),
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
  if (registry.activeRuns.has(identity.runId) || registry.stoppedRuns.has(identity.runId)) {
    throw new Error(`分析运行 runId 已登记: ${identity.runId}`);
  }

  const immutableIdentity = Object.freeze({ ...identity });
  const activeRun: ActiveRun = {
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
    dispose() {
      registry.activeRuns.delete(immutableIdentity.runId);
    },
  };
}

export function requestAnalysisRunStop(identity: AnalysisRunIdentity): StopAnalysisRunResult {
  const registry = getRegistry();
  const activeRun = registry.activeRuns.get(identity.runId);

  if (activeRun) {
    assertMatchingIdentity(activeRun.identity, identity);
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

export function resetAnalysisRunRegistryForTests() {
  const registry = getRegistry();
  registry.activeRuns.clear();
  registry.stoppedRuns.clear();
}
