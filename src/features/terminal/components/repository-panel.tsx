"use client";
import { useState } from "react";
import type {
  TerminalRepoGitStatus,
  TerminalRepoSignalConfig,
  UploadTargetKind,
} from "@/domain/terminal/types";
import { Button } from "@/shared/ui/button";
import { parseGitStatusLine, selectionKey } from "../commands";
import type { TerminalAction } from "../terminal-client";
interface Props {
  statuses: TerminalRepoGitStatus[];
  configs: TerminalRepoSignalConfig[];
  busy: boolean;
  enabled: boolean;
  message: string;
  action: (a: TerminalAction) => boolean;
  upload: (kind: UploadTargetKind) => void;
  command: (kind: "checkout" | "pull" | "signal") => void;
}
export function RepositoryPanel({
  statuses,
  configs,
  busy,
  enabled,
  message,
  action,
  upload,
  command,
}: Props) {
  const [selected, setSelected] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [configSelection, setConfigSelection] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const disabled = !enabled || busy;
  const toggle = (key: string, file: string, value: boolean) =>
    setSelected((s) => ({ ...s, [key]: { ...s[key], [file]: value } }));
  function gitAction(
    type: "gitAdd" | "gitCheckout" | "gitReset",
    status: TerminalRepoGitStatus,
  ) {
    const key = selectionKey(status.repoPath, status.branchName);
    const files = status.output
      .split("\n")
      .map(parseGitStatusLine)
      .filter(
        (p) =>
          p.isFile &&
          selected[key]?.[p.filePath] &&
          (type === "gitReset" ? p.staged : p.unstaged),
      )
      .map((p) => p.filePath);
    if (!files.length) return;
    if (
      type === "gitCheckout" &&
      !window.confirm(
        `确认放弃 ${files.length} 个文件的工作区修改？未跟踪文件会被删除，此操作不可逆。`,
      )
    )
      return;
    if (action({ type, repoPath: status.repoPath, files }))
      setSelected((s) => ({ ...s, [key]: {} }));
  }
  function configure() {
    const repos = configs
      .filter((c) => c.status === "success")
      .map((c) => ({
        repoPath: c.repoPath,
        files: c.files
          .filter(
            (f) =>
              configSelection[selectionKey(c.repoPath, c.branchName)]?.[
                f.filePath
              ] === false,
          )
          .map((f) => f.filePath),
      }))
      .filter((r) => r.files.length);
    const count = repos.reduce((n, r) => n + r.files.length, 0);
    if (!count) {
      window.alert("没有未选中的配置文件，无需恢复。");
      return;
    }
    if (
      window.confirm(
        `确认恢复 ${count} 个未选中的配置文件？这些文件的工作区修改将被放弃。`,
      )
    )
      action({ type: "checkoutSignalConfigFiles", repos });
  }
  return (
    <aside
      aria-label="Repo 状态面板"
      className="min-w-0 space-y-4 overflow-auto p-4 lg:h-[620px]"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Repo 状态</h2>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => action({ type: "projectGitStatus" })}
        >
          刷新状态
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" disabled={disabled} onClick={() => upload("xls")}>
          上传 xls
        </Button>
        <Button size="sm" disabled={disabled} onClick={() => upload("dbc")}>
          上传 dbc
        </Button>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => upload("mcuHeader")}
        >
          上传 mcu.h
        </Button>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => command("checkout")}
        >
          一键 checkout
        </Button>
        <Button size="sm" disabled={disabled} onClick={() => command("pull")}>
          一键 pull
        </Button>
        <Button size="sm" disabled={disabled} onClick={() => command("signal")}>
          配信号
        </Button>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => action({ type: "packageFiles" })}
        >
          打包
        </Button>
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => action({ type: "packageChecklist" })}
        >
          检验checklist
        </Button>
      </div>
      <section className="space-y-3 rounded-lg border border-border bg-surface-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">配置文件</h3>
          <div className="flex gap-1">
            <Button
              size="sm"
              disabled={disabled}
              onClick={() => action({ type: "signalConfigFiles" })}
            >
              刷新配置
            </Button>
            <Button
              size="sm"
              disabled={disabled || !configs.some((c) => c.files.length)}
              onClick={configure}
            >
              配置
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          默认全选保留文件；取消勾选后点击配置，恢复未选中的文件。
        </p>
        {!configs.length && (
          <p className="text-xs text-muted-foreground">
            {busy
              ? "正在读取配置文件…"
              : message ||
                "连接并选择项目分支后自动读取 tools/json/config_*.json。"}
          </p>
        )}
        {configs.map((c) => {
          const key = selectionKey(c.repoPath, c.branchName);
          return (
            <section key={key} className="space-y-2">
              <h4 className="break-all text-xs font-medium">
                {c.repoName} · {c.branchName}
              </h4>
              {c.error && (
                <p role="alert" className="break-all text-xs text-destructive">
                  {c.error}
                </p>
              )}
              {!c.files.length && (
                <p className="text-xs text-muted-foreground">
                  未找到 config_*.json
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {c.files.map((f) => (
                  <label
                    key={f.filePath}
                    title={f.filePath}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs"
                  >
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={configSelection[key]?.[f.filePath] !== false}
                      onChange={(e) =>
                        setConfigSelection((s) => ({
                          ...s,
                          [key]: { ...s[key], [f.filePath]: e.target.checked },
                        }))
                      }
                    />
                    <span className="break-all">{f.label}</span>
                  </label>
                ))}
              </div>
            </section>
          );
        })}
      </section>
      {!statuses.length && (
        <p className="text-xs text-muted-foreground">
          连接后查看当前项目分支下的仓库状态。
        </p>
      )}
      {statuses.map((status) => {
        const key = selectionKey(status.repoPath, status.branchName);
        const lines = status.output
          .split("\n")
          .map((line) => ({ line, ...parseGitStatusLine(line) }));
        const unstaged = lines.filter(
          (p) => p.isFile && p.unstaged && selected[key]?.[p.filePath],
        ).length;
        const staged = lines.filter(
          (p) => p.isFile && p.staged && selected[key]?.[p.filePath],
        ).length;
        return (
          <section
            key={key}
            className="space-y-2 rounded-lg border border-border p-3"
          >
            <div className="flex justify-between gap-2">
              <h3 className="break-all text-sm font-medium">
                {status.repoName}
              </h3>
              <span
                className={`text-xs ${status.status === "failed" ? "text-destructive" : "text-success"}`}
              >
                {status.status === "failed" ? "失败" : "成功"}
              </span>
            </div>
            <p className="break-all text-xs text-muted-foreground">
              {status.branchName} · {status.repoPath}
            </p>
            <div className="max-h-64 overflow-auto rounded bg-surface-2 p-2 font-mono text-xs">
              {lines.map((p, i) =>
                p.isFile ? (
                  <label
                    key={i}
                    className={`flex items-start gap-2 py-0.5 ${p.color}`}
                  >
                    <input
                      type="checkbox"
                      aria-label={`选择 ${p.filePath}`}
                      disabled={disabled}
                      checked={!!selected[key]?.[p.filePath]}
                      onChange={(e) =>
                        toggle(key, p.filePath, e.target.checked)
                      }
                      className="mt-0.5 shrink-0"
                    />
                    <span className="whitespace-pre-wrap break-all">
                      {p.line}
                    </span>
                  </label>
                ) : (
                  <p
                    key={i}
                    className={`whitespace-pre-wrap break-all ${p.color}`}
                  >
                    {p.line || " "}
                  </p>
                ),
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-1">
              <Button
                size="sm"
                disabled={disabled || !unstaged}
                onClick={() => gitAction("gitAdd", status)}
              >
                git add ({unstaged})
              </Button>
              <Button
                size="sm"
                variant="destructive-outline"
                disabled={disabled || !unstaged}
                onClick={() => gitAction("gitCheckout", status)}
              >
                checkout
              </Button>
              <Button
                size="sm"
                disabled={disabled || !staged}
                onClick={() => gitAction("gitReset", status)}
              >
                git reset ({staged})
              </Button>
            </div>
          </section>
        );
      })}
    </aside>
  );
}
