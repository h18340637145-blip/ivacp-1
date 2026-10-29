import type {
  ClientTerminalMessage,
  ServerTerminalMessage,
  TerminalProjectContext,
} from "@/domain/terminal/types";
import { contextKey } from "./commands";
type ContextAction = Exclude<
  ClientTerminalMessage,
  {
    type: "connect" | "input" | "resize" | "disconnect" | "syncProjects";
  }
>;
export type TerminalAction = ContextAction extends infer A
  ? A extends ContextAction
    ? Omit<A, "sessionId" | "projectContext">
    : never
  : never;
type Pending = {
  action: TerminalAction;
  context: TerminalProjectContext;
  key: string;
  epoch: number;
  requestId: string;
};
const expected = (type: TerminalAction["type"]) =>
  type === "signalConfigFiles" || type === "checkoutSignalConfigFiles"
    ? "signalConfigFiles"
    : type === "packageFiles" || type === "packageChecklist"
      ? "fileDownload"
      : "gitStatus";
/** Serialize structured actions and correlate every reply with its request and context.
 * A timeout ends the connection instead of assigning a late reply to another request. */
export class TerminalClient {
  private session?: string;
  private context?: TerminalProjectContext;
  private epoch = 0;
  private sequence = 0;
  private stopped = false;
  private pending?: Pending;
  private queue: Pending[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private syncId?: string;
  private syncTimer?: ReturnType<typeof setTimeout>;
  constructor(
    private targetId: string,
    private send: (message: ClientTerminalMessage) => void,
    private emit: (message: ServerTerminalMessage) => void,
    private busy: (value: boolean) => void = () => {},
    private fatal: (reason: string) => void = () => {},
  ) {}
  setContext(context?: TerminalProjectContext) {
    if (contextKey(this.context) === contextKey(context)) return;
    this.context = context;
    this.epoch++;
    this.queue = [];
  }
  input(data: string) {
    if (!this.stopped && this.session)
      this.send({
        type: "input",
        sessionId: this.session,
        data,
        projectContext: this.context,
      });
  }
  resize(cols: number, rows: number) {
    if (!this.stopped && this.session)
      this.send({ type: "resize", sessionId: this.session, cols, rows });
  }
  startSync() {
    if (this.stopped || !this.session || this.syncId) return false;
    this.syncId = `sync-${this.targetId}-${Date.now()}-${++this.sequence}`;
    this.armSyncTimeout();
    this.send({ type: "syncProjects", sessionId: this.session, requestId: this.syncId });
    return true;
  }
  private armSyncTimeout() {
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncId = undefined;
      this.emit({ type: "status", sessionId: this.session, status: "sync_error", message: "同步进度连接超时，终端仍可使用；请核对配置目录后重试。" });
    }, 45000);
  }
  enqueue(action: TerminalAction) {
    if (this.stopped || !this.session || !this.context) return false;
    const key = JSON.stringify([this.epoch, action]);
    if (this.pending?.key === key || this.queue.some((p) => p.key === key))
      return false;
    this.queue.push({
      action,
      context: this.context,
      key,
      epoch: this.epoch,
      requestId: `${this.targetId}-${Date.now()}-${++this.sequence}`,
    });
    this.pump();
    return true;
  }
  private pump() {
    if (this.stopped || this.pending) return;
    const next = this.queue.shift();
    if (!next) {
      this.busy(false);
      return;
    }
    this.pending = next;
    this.busy(true);
    this.timer = setTimeout(() => {
      if (next.action.type === "signalConfigFiles" || next.action.type === "projectGitStatus") {
        // Queries cannot mutate remote state. Drop queued actions rather than running
        // a mutation after the user has seen a timeout; late replies retain old IDs.
        this.queue = [];
        this.pending = undefined;
        this.busy(false);
        this.emit({ type: "status", sessionId: this.session, status: "error",
          message: "仓库查询超时，终端仍可使用，请点击刷新重试；排队操作已取消。" });
      } else {
        this.fatal("终端操作响应超时，请重新连接后核对远端状态。");
        this.dispose();
      }
    }, 30000);
    this.send({
      ...next.action,
      sessionId: this.session!,
      projectContext: next.context,
      requestId: next.requestId,
    } as ClientTerminalMessage);
  }
  receive(raw: string) {
    if (this.stopped) return;
    let message: ServerTerminalMessage;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (
      !message ||
      typeof message !== "object" ||
      typeof message.type !== "string"
    )
      return;
    if (message.type === "connected") {
      if (
        this.session ||
        message.targetId !== this.targetId ||
        typeof message.sessionId !== "string"
      )
        return;
      this.session = message.sessionId;
      this.emit(message);
      return;
    }
    // A sync is scoped to the SSH session and frozen server-side configuration,
    // independent of the currently selected UI project/branch.
    if (this.syncId && message.requestId === this.syncId && (!message.sessionId || message.sessionId === this.session)) {
      if (message.type === "status" && message.status === "error" && typeof message.message === "string") {
        clearTimeout(this.syncTimer); this.syncId = undefined;
        this.emit({ ...message, status: "sync_error" }); return;
      }
      if (message.type === "syncProgress" || message.type === "syncResult") {
        const progress = message.type === "syncProgress" ? message.progress : message.report;
        if (!progress || progress.targetId !== this.targetId || typeof progress.runId !== "string" || typeof progress.message !== "string" || !Number.isFinite(progress.totalBranches) || !Number.isFinite(progress.completedBranches)) return;
        if (message.type === "syncResult" && !Array.isArray(message.report.branches)) return;
        if (message.type === "syncResult") { clearTimeout(this.syncTimer); this.syncId = undefined; }
        else this.armSyncTimeout();
        this.emit(message); return;
      }
    }
    if (message.type === "syncProgress" || message.type === "syncResult") return;
    if (message.type === "status" && !message.sessionId) {
      if (
        typeof message.message !== "string" ||
        typeof message.status !== "string"
      )
        return;
      if (message.requestId) {
        if (message.requestId !== this.pending?.requestId) return;
        if (this.pending.epoch === this.epoch) this.emit(message);
        if (message.status === "error") this.finish();
      } else if (!this.session) this.emit(message);
      return;
    }
    if (
      !this.session ||
      !("sessionId" in message) ||
      message.sessionId !== this.session
    )
      return;
    if (
      message.type === "blocked" &&
      (typeof message.reason !== "string" ||
        typeof message.command !== "string")
    )
      return;
    if (message.type === "closed" && typeof message.reason !== "string") return;
    if (message.type === "output" && typeof message.data !== "string") return;
    if (
      message.type === "gitStatus" &&
      (!Array.isArray(message.statuses) ||
        !message.statuses.every(
          (s) =>
            s &&
            typeof s.repoPath === "string" &&
            typeof s.branchName === "string" &&
            typeof s.output === "string" &&
            typeof s.repoName === "string" &&
            ["success", "failed"].includes(s.status),
        ))
    )
      return;
    if (
      message.type === "signalConfigFiles" &&
      (!Array.isArray(message.configs) ||
        !message.configs.every(
          (c) =>
            c &&
            typeof c.repoPath === "string" &&
            typeof c.branchName === "string" &&
            typeof c.repoName === "string" &&
            ["success", "failed"].includes(c.status) &&
            (!c.error || typeof c.error === "string") &&
            Array.isArray(c.files) &&
            c.files.every(
              (f) =>
                f &&
                typeof f.filePath === "string" &&
                typeof f.label === "string",
            ),
        ))
    )
      return;
    if (
      message.type === "fileDownload" &&
      (typeof message.fileName !== "string" ||
        typeof message.contentBase64 !== "string" ||
        typeof message.mimeType !== "string")
    )
      return;
    if (
      message.type === "status" &&
      (typeof message.message !== "string" ||
        typeof message.status !== "string")
    )
      return;
    if (
      ![
        "output",
        "blocked",
        "closed",
        "status",
        "gitStatus",
        "signalConfigFiles",
        "fileDownload",
      ].includes(message.type)
    )
      return;
    const structured = [
      "gitStatus",
      "signalConfigFiles",
      "fileDownload",
    ].includes(message.type);
    const pending = this.pending;
    const matched = !!pending && message.requestId === pending.requestId;
    if (message.requestId && !matched) return;
    const current =
      (!pending || !matched || pending.epoch === this.epoch) &&
      (!structured || message.contextKey === contextKey(this.context));
    if (
      message.type === "fileDownload" &&
      (!matched || !pending || expected(pending.action.type) !== "fileDownload")
    )
      return;
    if (!structured || current) {
      if (
        message.type !== "status" ||
        !matched ||
        pending?.epoch === this.epoch
      )
        this.emit(message);
    }
    if (message.type === "closed") {
      this.dispose();
      return;
    }
    if (
      matched &&
      pending &&
      (message.type === expected(pending.action.type) ||
        (message.type === "status" && message.status === "error"))
    )
      this.finish();
  }
  private finish() {
    clearTimeout(this.timer);
    this.pending = undefined;
    this.pump();
  }
  dispose() {
    clearTimeout(this.syncTimer);
    this.syncId = undefined;
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.timer);
    this.queue = [];
    this.pending = undefined;
    if (this.session)
      this.send({ type: "disconnect", sessionId: this.session });
    this.session = undefined;
    this.busy(false);
  }
}
