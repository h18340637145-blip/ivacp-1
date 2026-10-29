"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type {
  PublicRemoteShellTarget,
  ServerTerminalMessage,
  TerminalProject,
  TerminalProjectContext,
  TerminalRepoGitStatus,
  TerminalRepoSignalConfig,
  UploadTargetKind,
} from "@/domain/terminal/types";
import type { TerminalSyncBranchResult, TerminalSyncProgress, TerminalBranchVhal } from "@/domain/terminal/sync";
import { SyncPanel } from "./sync-panel";
import { Button } from "@/shared/ui/button";
import { TerminalPane, type TerminalPaneHandle } from "./terminal-pane";
import { RepositoryPanel } from "./repository-panel";
import {
  buildAllReposCommand,
  buildBranchCheckoutCommand,
  buildProjectCdCommand,
  buildSignalConfigCommand,
  contextKey,
  CommandGate,
} from "../commands";
import { downloadBase64File, readUpload } from "../browser-files";
import type { TerminalAction } from "../terminal-client";
export type ConnectionState = "connecting" | "connected" | "closed" | "failed";
const states: Record<ConnectionState, string> = {
  connecting: "连接中",
  connected: "已连接",
  closed: "已断开",
  failed: "连接失败",
};
interface Props {
  target: PublicRemoteShellTarget;
  projects: TerminalProject[];
  gatewayUrl: string;
  active: boolean;
  onState: (state: ConnectionState) => void;
}
export function TerminalWorkspace({
  target,
  projects,
  gatewayUrl,
  active,
  onState,
}: Props) {
  const [projectName, setProjectName] = useState(
    projects[0]?.projectName ?? "",
  );
  const [branchName, setBranchName] = useState(
    projects[0]?.branches[0]?.name ?? "",
  );
  const [state, setState] = useState<ConnectionState>("connecting");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<TerminalSyncProgress>();
  const [syncBranches, setSyncBranches] = useState<TerminalSyncBranchResult[]>([]);
  const [syncError, setSyncError] = useState("");
  const [branchVersions, setBranchVersions] = useState<Record<string, TerminalBranchVhal | undefined>>({});
  const syncActive = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [width, setWidth] = useState(370);
  const [statuses, setStatuses] = useState<TerminalRepoGitStatus[]>([]);
  const [configs, setConfigs] = useState<TerminalRepoSignalConfig[]>([]);
  const commandGate = useRef(new CommandGate());
  const initializedAttempt = useRef(-1);
  const pane = useRef<TerminalPaneHandle>(null);
  const input = useRef<HTMLInputElement>(null);
  const uploadKind = useRef<UploadTargetKind>("xls");
  const uploadEpoch = useRef("");
  const root = useRef<HTMLDivElement>(null);
  const resizeCleanup = useRef<() => void>(() => {});
  const project = projects.find((p) => p.projectName === projectName);
  const branch = project?.branches.find((b) => b.name === branchName);
  const versionKey = JSON.stringify([projectName, branchName]);
  const selectedVhal = Object.prototype.hasOwnProperty.call(branchVersions, versionKey) ? branchVersions[versionKey] : branch?.syncedVhal;
  const currentVhal = selectedVhal?.targetId === target.id ? selectedVhal : undefined;
  const context = useMemo(
    () => (project && branch ? { project, branch } : undefined),
    [project, branch],
  );
  const key = contextKey(context);
  const currentKey = useRef(key);
  useEffect(() => {
    currentKey.current = `${attempt}:${key}`;
  }, [key, attempt]);
  useEffect(() => () => resizeCleanup.current(), []);
  const handleState = useCallback(
    (next: ConnectionState, message?: string) => {
      setState(next);
      if (next !== "connected" && syncActive.current) {
        syncActive.current = false; setSyncing(false);
        setSyncError("同步连接已中断；已发布分支组保留，请重连后同步以核对和补齐。任务可能仍在结束当前本地发布。");
      }
      onState(next);
      if (message) setError(message);
      if (next === "connected") setError("");
    },
    [onState],
  );
  const handleMessage = useCallback((message: ServerTerminalMessage) => {
    if (message.type === "syncProgress") {
      setSyncProgress(message.progress);
      const branch = message.progress.branch;
      if (branch) {
        setSyncBranches(current => [...current.filter(b => b.projectName !== branch.projectName || b.branchName !== branch.branchName), branch]);
        if (branch.status !== "failed") setBranchVersions(current => ({ ...current, [JSON.stringify([branch.projectName, branch.branchName])]: branch.vhal }));
      }
      return;
    }
    if (message.type === "syncResult") {
      setSyncProgress(message.report); setSyncBranches(message.report.branches);
      setBranchVersions(current => {
        const next = { ...current };
        for (const branch of message.report.branches) if (branch.status !== "failed") next[JSON.stringify([branch.projectName, branch.branchName])] = branch.vhal;
        return next;
      });
      syncActive.current = false; setSyncing(false); return;
    }
    if (message.type === "status" && message.status === "sync_error") {
      syncActive.current = false; setSyncing(false); setSyncError(message.message); return;
    }
    if (message.type === "gitStatus") setStatuses(message.statuses);
    if (message.type === "signalConfigFiles") setConfigs(message.configs);
    if (message.type === "status") {
      if (message.status === "error") setError(message.message);
      else setNotice(message.message);
    }
    if (message.type === "fileDownload") {
      try {
        downloadBase64File(
          message.fileName,
          message.mimeType,
          message.contentBase64,
        );
        setNotice(`已下载 ${message.fileName}`);
      } catch {
        setError("下载失败：网关返回的文件内容无效，请重新下载。");
      }
    }
  }, []);
  useEffect(() => {
    if (state !== "connected" || !context) return;
    pane.current?.configure(
      context,
      initializedAttempt.current !== attempt
        ? buildProjectCdCommand(context)
        : undefined,
    );
    initializedAttempt.current = attempt;
    pane.current?.enqueue({ type: "signalConfigFiles" });
    pane.current?.enqueue({ type: "projectGitStatus" });
  }, [state, key, context, attempt]);
  function action(a: TerminalAction) {
    setError("");
    return pane.current?.enqueue(a) ?? false;
  }
  function selectContext(next: TerminalProjectContext, command: string) {
    setStatuses([]);
    setConfigs([]);
    setNotice("");
    setError("");
    pane.current?.configure(next, command);
  }
  function command(kind: "checkout" | "pull" | "signal") {
    if (!context || busy || state !== "connected") return;
    if (
      kind === "checkout" &&
      !window.confirm(
        "确认对当前分支全部仓库执行 git checkout .？所有已跟踪文件的未暂存修改将被放弃。",
      )
    )
      return;
    const data =
      kind === "signal"
        ? buildSignalConfigCommand(context)
        : buildAllReposCommand(
            context,
            kind === "checkout" ? "git checkout ." : "git pull",
          );
    if (commandGate.current.accept(data)) pane.current?.input(data);
  }
  function upload(kind: UploadTargetKind) {
    if (!input.current) return;
    uploadKind.current = kind;
    uploadEpoch.current = currentKey.current;
    input.current.accept =
      kind === "xls" ? ".xls,.xlsx" : kind === "dbc" ? ".dbc" : ".h";
    input.current.value = "";
    input.current.click();
  }
  function resize(event: PointerEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const start = event.clientX;
    const initial = width;
    const move = (e: globalThis.PointerEvent) =>
      setWidth(
        Math.max(
          280,
          Math.min(
            Math.min(620, (root.current?.clientWidth ?? 1000) * 0.6),
            initial + start - e.clientX,
          ),
        ),
      );
    const end = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", end);
      element.removeEventListener("pointercancel", end);
    };
    resizeCleanup.current();
    resizeCleanup.current = end;
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", end);
    element.addEventListener("pointercancel", end);
  }
  const disabled = state !== "connected" || busy;
  return (
    <div className="min-w-0" data-terminal-workspace={target.id}>
      <div className="flex flex-wrap items-end gap-3 border-b border-border bg-surface-2 p-3">
        <label className="grid min-w-0 flex-1 gap-1 text-xs text-muted-foreground">
          项目
          <select
            aria-label="项目"
            value={projectName}
            disabled={disabled}
            className="h-9 min-w-0 rounded-md border border-border bg-surface px-2 text-sm text-foreground"
            onChange={(event) => {
              const p = projects.find(
                (v) => v.projectName === event.target.value,
              );
              if (!p) return;
              setProjectName(p.projectName);
              setBranchName(p.branches[0]?.name ?? "");
              const b = p.branches[0];
              if (b)
                selectContext(
                  { project: p, branch: b },
                  buildProjectCdCommand({ project: p, branch: b }),
                );
            }}
          >
            {!projects.length && <option value="">暂无项目配置</option>}
            {projects.map((p) => (
              <option key={p.projectName}>{p.projectName}</option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 flex-1 gap-1 text-xs text-muted-foreground">
          分支
          <select
            aria-label="分支"
            value={branchName}
            disabled={disabled || !project}
            className="h-9 min-w-0 rounded-md border border-border bg-surface px-2 text-sm text-foreground"
            onChange={(event) => {
              const b = project?.branches.find(
                (v) => v.name === event.target.value,
              );
              if (!project || !b) return;
              if (
                !window.confirm(
                  `确认切换到 ${b.name}？checkout 失败时会自动 stash（含未跟踪文件）后重试。`,
                )
              )
                return;
              setBranchName(b.name);
              const next = { project, branch: b };
              selectContext(next, buildBranchCheckoutCommand(next));
            }}
          >
            {project?.branches.map((b) => (
              <option key={b.name}>{b.name}</option>
            ))}
          </select>
        </label>
        <span role="status" className="pb-2 text-xs text-muted-foreground">
          {states[state]}
          {busy ? " · 操作处理中" : ""}
        </span>
        {state === "connected" ? (
          <Button size="sm" onClick={() => pane.current?.disconnect()}>
            断开连接
          </Button>
        ) : state !== "connecting" ? (
          <Button
            size="sm"
            onClick={() => {
              if (window.confirm(`确认重新连接 ${target.name}？`)) {
                setStatuses([]);
                setConfigs([]);
                setAttempt((v) => v + 1);
                setState("connecting");
              }
            }}
          >
            重新连接
          </Button>
        ) : null}
      </div>
      <p aria-label="当前分支 VHAL 版本" className="break-all border-b border-border px-3 py-2 text-sm text-muted-foreground">
        当前分支已经配置的最新vhal版本是：{currentVhal?.raw ?? "未提取到"}
      </p>
      <SyncPanel connected={state === "connected"} running={syncing} targetName={target.name}
        counts={{ projects: projects.length, branches: projects.reduce((n, p) => n + p.branches.length, 0), repos: projects.reduce((n, p) => n + p.branches.reduce((n, b) => n + b.repos.length, 0), 0) }}
        progress={syncProgress} branches={syncBranches} error={syncError}
        start={() => {
          if (!pane.current?.startSync()) { setSyncError("同步请求未发送，请确认连接或等待当前同步完成。"); return; }
          syncActive.current = true; setSyncing(true); setSyncError(""); setSyncProgress(undefined); setSyncBranches([]);
        }} />
      {error && (
        <p
          role="alert"
          className="break-all border-b border-destructive/20 bg-destructive-soft p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="break-all border-b border-border p-2 text-xs text-muted-foreground"
        >
          {notice}
        </p>
      )}
      <div ref={root} className="flex min-w-0 flex-col lg:flex-row">
        <section
          aria-label={`${target.name}终端`}
          className="h-[420px] min-w-0 flex-1 lg:h-[620px]"
        >
          <TerminalPane
            key={attempt}
            ref={pane}
            targetId={target.id}
            gatewayUrl={gatewayUrl}
            context={context}
            active={active}
            onMessage={handleMessage}
            onState={handleState}
            onBusy={setBusy}
          />
        </section>
        <div
          role="separator"
          aria-label="调整 Repo 状态面板宽度"
          aria-orientation="vertical"
          aria-valuenow={Math.round(width)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              setWidth((w) => Math.min(620, w + 20));
            }
            if (e.key === "ArrowRight") {
              e.preventDefault();
              setWidth((w) => Math.max(280, w - 20));
            }
          }}
          onPointerDown={resize}
          className="hidden w-1.5 shrink-0 touch-none cursor-col-resize border-x border-border bg-surface-2 hover:bg-primary/30 lg:block"
        />
        <div
          style={
            { "--terminal-panel-width": `${width}px` } as React.CSSProperties
          }
          className="min-w-0 border-t border-border lg:w-[var(--terminal-panel-width)] lg:shrink-0 lg:border-t-0"
        >
          <RepositoryPanel
            key={key + ":" + attempt}
            statuses={statuses}
            configs={configs}
            busy={busy}
            enabled={state === "connected" && !!context}
            message={error}
            action={action}
            upload={upload}
            command={command}
          />
        </div>
      </div>
      <input
        ref={input}
        type="file"
        aria-label="上传终端文件"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const token = uploadEpoch.current;
          const kind = uploadKind.current;
          setError("");
          try {
            const contentBase64 = await readUpload(file);
            if (token !== currentKey.current) {
              setError("项目或连接已切换，请重新选择上传文件。");
              return;
            }
            if (
              !action({
                type: "uploadFile",
                uploadKind: kind,
                fileName: file.name,
                contentBase64,
              })
            )
              setError("终端未连接或上传请求重复，请核对后重试。");
          } catch (error) {
            setError(error instanceof Error ? error.message : "文件读取失败");
          }
        }}
      />
    </div>
  );
}
