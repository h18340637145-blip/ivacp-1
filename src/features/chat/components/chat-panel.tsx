"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Loader2, MessageSquare, Send, Square, Trash2 } from "lucide-react";
import type { ChatMessageRecord } from "@/domain/entities";
import { newId } from "@/shared/lib/ids";
import { errorMessage } from "@/shared/lib/errors";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/input";
import { Callout, EmptyState, ErrorState, Spinner } from "@/shared/ui/feedback";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import { Tooltip } from "@/shared/ui/tooltip";
import { clearChatMessages, listChatMessages, prepareContext, saveChatMessage, streamChat } from "../lib/conversation";
import { rememberExchange } from "../lib/memory-service";

interface ChatPanelProps {
  userId: string;
  /** 后台记忆抽取完成后通知记忆面板刷新 */
  onMemoryChanged: () => void;
}

export function ChatPanel({ userId, onMemoryChanged }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"retrieving" | "answering" | null>(null);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setMessages(await listChatMessages(userId));
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // 关闭抽屉不打断进行中的回复：请求继续完成并写入 IndexedDB，下次打开可见
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streaming]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setNotice(null);
    setPhase("retrieving");
    const userMsg: ChatMessageRecord = { id: newId(), userId, role: "user", content: text, createdAt: new Date().toISOString() };
    const history = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await saveChatMessage(userMsg);
      setMessages((m) => [...m, userMsg]);
      const { context, memories } = await prepareContext(userId, text);
      setPhase("answering");
      setStreaming("");
      const replyText = await streamChat({ message: text, history, context, memories }, setStreaming, controller.signal);
      const reply: ChatMessageRecord = {
        id: newId(),
        userId,
        role: "assistant",
        content: replyText || "（无回复）",
        sources: [...new Set(context.map((c) => c.docName))],
        createdAt: new Date().toISOString(),
      };
      await saveChatMessage(reply);
      setMessages((m) => [...m, reply]);
      void rememberExchange(userId, text, reply.content)
        .then(onMemoryChanged)
        .catch(() => undefined);
    } catch (error) {
      if (!controller.signal.aborted) setNotice(errorMessage(error));
    } finally {
      setStreaming(null);
      setPhase(null);
      setBusy(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  const clear = async () => {
    await clearChatMessages(userId);
    setMessages([]);
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner label="加载对话" />
      </div>
    );
  }
  if (loadError) return <ErrorState error={loadError} onRetry={load} className="m-4" />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
        {messages.length === 0 && streaming === null ? (
          <EmptyState
            icon={<MessageSquare aria-hidden />}
            title="开始对话"
            description="向助手提问；知识库文档、未归档笔记与长期记忆会作为回答依据。"
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((m) => (
              <MessageBubble key={m.id} role={m.role} content={m.content} sources={m.sources} />
            ))}
            {streaming !== null && streaming !== "" ? <MessageBubble role="assistant" content={streaming} streaming /> : null}
          </ul>
        )}
        {phase ? (
          <p role="status" className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            {phase === "retrieving" ? "正在检索知识库与记忆…" : streaming ? "正在生成…" : "思考中…"}
          </p>
        ) : null}
        <div ref={endRef} />
      </div>

      {notice ? (
        <Callout tone="danger" className="mx-4 mb-2">
          {notice}
        </Callout>
      ) : null}

      <form
        className="flex items-end gap-2 border-t border-border px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Tooltip content="清空对话">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="清空对话"
            disabled={busy || messages.length === 0}
            onClick={() => setConfirmClear(true)}
          >
            <Trash2 aria-hidden />
          </Button>
        </Tooltip>
        <Textarea
          aria-label="输入问题"
          placeholder="输入问题，Enter 发送，Shift+Enter 换行"
          rows={2}
          className="min-h-10 flex-1 resize-none"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {busy ? (
          <Button type="button" variant="outline" size="icon" aria-label="停止生成" onClick={stop}>
            <Square aria-hidden />
          </Button>
        ) : (
          <Button type="submit" variant="primary" size="icon" aria-label="发送" disabled={!input.trim()}>
            <Send aria-hidden />
          </Button>
        )}
      </form>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="清空对话"
        description="将删除当前用户在本浏览器中的全部对话记录，不影响知识库、记忆与笔记。"
        confirmText="清空"
        destructive
        onConfirm={clear}
      />
    </div>
  );
}

function MessageBubble({
  role,
  content,
  sources,
  streaming,
}: {
  role: ChatMessageRecord["role"];
  content: string;
  sources?: string[];
  streaming?: boolean;
}) {
  const mine = role === "user";
  return (
    <li className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
      <span className="sr-only">{mine ? "我" : "助手"}</span>
      <div
        className={cn(
          "max-w-[88%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm leading-relaxed",
          mine ? "bg-primary-soft text-foreground" : "border border-border bg-surface-2 text-foreground",
        )}
      >
        {content}
        {streaming ? <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-muted-foreground align-text-bottom" aria-hidden /> : null}
      </div>
      {sources && sources.length > 0 ? (
        <p className="flex max-w-[88%] items-start gap-1 text-xs text-muted-foreground">
          <BookOpen className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>参考：{sources.join("、")}</span>
        </p>
      ) : null}
    </li>
  );
}
