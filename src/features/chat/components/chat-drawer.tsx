"use client";

import { useCallback, useEffect, useState } from "react";
import { Brain, Library, MessageSquare, NotebookPen, UserRound } from "lucide-react";
import { useSession } from "@/features/auth/session-store";
import { errorMessage } from "@/shared/lib/errors";
import { Sheet, SheetContent } from "@/shared/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { EmptyState, ErrorState, Spinner } from "@/shared/ui/feedback";
import { claimOrphanRecords } from "../lib/knowledge-service";
import { forgetStaleMemories } from "../lib/memory-service";
import { ChatPanel } from "./chat-panel";
import { KnowledgePanel } from "./knowledge-panel";
import { MemoryPanel } from "./memory-panel";
import { NotesPanel } from "./notes-panel";

type Tab = "chat" | "knowledge" | "memory" | "notes";

const panelClass = "flex min-h-0 flex-1 flex-col pt-0 data-[state=inactive]:hidden";

/** 智能助手抽屉（对话 / 知识库 / 记忆 / 笔记），数据按登录用户隔离存于 IndexedDB */
export function ChatDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user, ready } = useSession();
  const uid = user?.username ?? null;
  const [tab, setTab] = useState<Tab>("chat");
  const [prepared, setPrepared] = useState<{ uid: string; error: string | null } | null>(null);
  const [docCount, setDocCount] = useState<number | null>(null);
  const [memoryVersion, setMemoryVersion] = useState(0);
  const [retry, setRetry] = useState(0);
  const preparedOk = !!uid && prepared?.uid === uid && !prepared.error;

  // 打开后首次准备：认领升级前无 userId 的旧数据，并清理过期记忆
  useEffect(() => {
    if (!open || !uid || preparedOk) return;
    let cancelled = false;
    (async () => {
      try {
        await claimOrphanRecords(uid);
        await forgetStaleMemories(uid);
        if (!cancelled) setPrepared({ uid, error: null });
      } catch (error) {
        if (!cancelled) setPrepared({ uid, error: errorMessage(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, uid, preparedOk, retry]);

  const bumpMemory = useCallback(() => setMemoryVersion((v) => v + 1), []);

  let body: React.ReactNode;
  if (!ready) {
    body = (
      <div className="flex flex-1 items-center justify-center">
        <Spinner label="正在获取登录信息" />
      </div>
    );
  } else if (!uid) {
    body = <EmptyState icon={<UserRound aria-hidden />} title="未获取到登录用户" description="请重新登录后再使用智能助手。" className="m-4" />;
  } else if (prepared?.uid === uid && prepared.error) {
    body = <ErrorState title="智能助手初始化失败" error={prepared.error} onRetry={() => setRetry((r) => r + 1)} className="m-4" />;
  } else if (!preparedOk) {
    body = (
      <div className="flex flex-1 items-center justify-center">
        <Spinner label="正在加载本地数据" />
      </div>
    );
  } else {
    body = (
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="flex w-full px-2" aria-label="智能助手功能">
          <TabsTrigger value="chat" className="flex-1 justify-center">
            <MessageSquare aria-hidden />
            对话
          </TabsTrigger>
          <TabsTrigger value="knowledge" className="flex-1 justify-center">
            <Library aria-hidden />
            知识库
            {docCount !== null ? <span className="text-xs tabular-nums text-muted-foreground">({docCount})</span> : null}
          </TabsTrigger>
          <TabsTrigger value="memory" className="flex-1 justify-center">
            <Brain aria-hidden />
            记忆
          </TabsTrigger>
          <TabsTrigger value="notes" className="flex-1 justify-center">
            <NotebookPen aria-hidden />
            笔记
          </TabsTrigger>
        </TabsList>
        {/* 对话与知识库常驻挂载：切换标签不中断流式回复/导入，知识库计数始终可见 */}
        <TabsContent value="chat" forceMount className={panelClass}>
          <ChatPanel key={uid} userId={uid} onMemoryChanged={bumpMemory} />
        </TabsContent>
        <TabsContent value="knowledge" forceMount className={panelClass}>
          <KnowledgePanel key={uid} userId={uid} onCountChange={setDocCount} />
        </TabsContent>
        <TabsContent value="memory" className={panelClass}>
          <MemoryPanel key={uid} userId={uid} version={memoryVersion} />
        </TabsContent>
        <TabsContent value="notes" className={panelClass}>
          <NotesPanel key={uid} userId={uid} />
        </TabsContent>
        <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
          当前用户：{user?.displayName ?? uid}（{uid}）· 数据按用户隔离，仅保存在本浏览器
        </p>
      </Tabs>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="智能助手" description="对话、知识库、记忆与笔记" className="w-[min(100vw,480px)]">
        {body}
      </SheetContent>
    </Sheet>
  );
}
