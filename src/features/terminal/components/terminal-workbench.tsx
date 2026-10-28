"use client";
import { useEffect, useState } from "react";
import { Plus, TerminalSquare, X } from "lucide-react";
import { useSession } from "@/features/auth/session-store";
import type {
  PublicRemoteShellTarget,
  TerminalProject,
} from "@/domain/terminal/types";
import { Button } from "@/shared/ui/button";
import { PageHeader } from "@/shared/ui/page-header";
import { TerminalWorkspace, type ConnectionState } from "./terminal-workspace";
import { loadTerminalConfiguration, resolveGatewayUrl } from "../service";
interface Tab {
  id: string;
  target: PublicRemoteShellTarget;
  state: ConnectionState;
}
const labels: Record<ConnectionState, string> = {
  connecting: "连接中",
  connected: "已连接",
  closed: "已断开",
  failed: "连接失败",
};
export function TerminalWorkbench() {
  const { ready, can } = useSession();
  const admin = can("admin");
  const [configuration, setConfiguration] = useState<{
    targets: PublicRemoteShellTarget[];
    projects: TerminalProject[];
  }>({ targets: [], projects: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [targetId, setTargetId] = useState("");
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState("");
  const [gatewayUrl] = useState(resolveGatewayUrl);
  useEffect(() => {
    if (!ready || !admin) return;
    const controller = new AbortController();
    void loadTerminalConfiguration(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setConfiguration(data);
        setTargetId(data.targets[0]?.id ?? "");
        setLoading(false);
        setError("");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setError(error instanceof Error ? error.message : "终端配置加载失败");
        setLoading(false);
      });
    return () => controller.abort();
  }, [ready, admin, retry]);
  const target = configuration.targets.find((t) => t.id === targetId);
  function connect() {
    if (!target) return;
    if (
      !window.confirm(
        `确认连接 ${target.name}？\n环境：${target.environment}\n风险等级：${target.riskLevel === "critical" ? "高风险" : "普通"}\n命令限制：${target.guardMode === "strict" ? "严格" : "基础"}\n命令输入将记录审计日志。`,
      )
    )
      return;
    const tab: Tab = { id: crypto.randomUUID(), target, state: "connecting" };
    setTabs((v) => [...v, tab]);
    setActiveId(tab.id);
  }
  function close(id: string) {
    setTabs((v) => v.filter((t) => t.id !== id));
    if (activeId === id) setActiveId(tabs.find((t) => t.id !== id)?.id ?? "");
  }
  if (!ready)
    return (
      <p className="p-6 text-sm text-muted-foreground">正在加载登录状态…</p>
    );
  if (!admin)
    return (
      <div className="p-6">
        <PageHeader title="远程终端" />
        <p role="alert" className="text-destructive">
          仅管理员可使用远程终端。
        </p>
      </div>
    );
  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-4 p-4 md:p-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <TerminalSquare className="size-5 text-primary" />
            远程终端工作台
          </span>
        }
        description="连接白名单服务器，管理项目仓库与信号配置。命令输入记录审计，终端输出不保存。"
      />
      <section
        aria-label="服务器连接"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <label className="grid min-w-0 flex-1 gap-1 text-xs text-muted-foreground">
          服务器
          <select
            aria-label="服务器"
            className="h-9 w-full min-w-0 rounded-md border border-border bg-surface-2 px-2 text-sm text-foreground"
            value={targetId}
            disabled={loading}
            onChange={(event) => setTargetId(event.target.value)}
          >
            {!configuration.targets.length && (
              <option value="">
                {loading ? "正在读取服务器…" : "暂无可用服务器"}
              </option>
            )}
            {configuration.targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.environment}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="primary"
          disabled={loading || !target}
          onClick={connect}
        >
          <Plus />
          连接服务器
        </Button>
        {target && (
          <p className="w-full break-all text-xs text-muted-foreground">
            {target.description} ·{" "}
            {target.riskLevel === "critical" ? "高风险环境" : "普通环境"} ·{" "}
            {target.guardMode === "strict" ? "严格限制" : "基础限制"}
          </p>
        )}
        {error && (
          <div className="flex w-full flex-wrap items-center gap-2">
            <p role="alert" className="break-all text-sm text-destructive">
              {error}
            </p>
            <Button
              size="sm"
              onClick={() => {
                setLoading(true);
                setRetry((v) => v + 1);
              }}
            >
              重新加载配置
            </Button>
          </div>
        )}
        {!loading && !error && !configuration.targets.length && (
          <p className="w-full text-sm text-muted-foreground">
            尚未配置白名单服务器，请由管理员检查服务器配置。
          </p>
        )}
      </section>
      <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface">
        <div
          role="tablist"
          aria-label="终端会话"
          className="flex min-w-0 gap-1 overflow-x-auto border-b border-border bg-surface-2 p-2"
        >
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`flex shrink-0 items-center rounded-md border ${tab.id === activeId ? "border-primary/30 bg-primary-soft" : "border-transparent"}`}
            >
              <button
                role="tab"
                aria-selected={tab.id === activeId}
                aria-controls={`terminal-${tab.id}`}
                id={`terminal-tab-${tab.id}`}
                onClick={() => setActiveId(tab.id)}
                className="max-w-60 truncate px-3 py-2 text-sm"
              >
                {tab.target.name} · {labels[tab.state]}
              </button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`关闭 ${tab.target.name} 终端`}
                onClick={() => close(tab.id)}
              >
                <X />
              </Button>
            </div>
          ))}
        </div>
        {!tabs.length && (
          <div className="flex min-h-72 flex-col items-center justify-center gap-3 p-6 text-muted-foreground">
            <TerminalSquare className="size-9 opacity-40" />
            <p className="text-sm">选择服务器并确认连接，开始终端会话。</p>
          </div>
        )}
        {tabs.map((tab) => (
          <div
            key={tab.id}
            id={`terminal-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`terminal-tab-${tab.id}`}
            hidden={tab.id !== activeId}
          >
            <TerminalWorkspace
              target={tab.target}
              projects={configuration.projects}
              gatewayUrl={gatewayUrl}
              active={tab.id === activeId}
              onState={(state) =>
                setTabs((current) =>
                  current.map((t) => (t.id === tab.id ? { ...t, state } : t)),
                )
              }
            />
          </div>
        ))}
      </section>
      <p className="text-xs text-muted-foreground">
        选中文字后 Ctrl+C 复制；Ctrl+Shift+C 复制；Ctrl/Cmd+V
        粘贴。右键有选区时复制，否则粘贴；剪贴板不可用时可用 Shift+Insert。
      </p>
    </div>
  );
}
