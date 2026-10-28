import { errorMessage } from "@/shared/lib/errors";
import { newId } from "@/shared/lib/ids";
import { clearChatMessages, listChatMessages, prepareContext, saveChatMessage, streamChat } from "./conversation";
import { rememberExchange } from "./memory-service";

export interface ChatRunState {
  busy: boolean;
  phase: "retrieving" | "answering" | null;
  streaming: string | null;
  notice: string | null;
  version: number;
}

export const IDLE_CHAT_RUN: ChatRunState = { busy: false, phase: null, streaming: null, notice: null, version: 0 };
const states = new Map<string, ChatRunState>();
const controllers = new Map<string, AbortController>();
const listeners = new Map<string, Set<() => void>>();

/** 运行属于账号，不属于抽屉的挂载周期；关闭重开后仍可观察、停止同一个请求。 */
export const getChatRun = (userId: string) => states.get(userId) ?? IDLE_CHAT_RUN;
export function subscribeChatRun(userId: string, listener: () => void) {
  const set = listeners.get(userId) ?? new Set();
  set.add(listener); listeners.set(userId, set);
  return () => { set.delete(listener); if (!set.size) listeners.delete(userId); };
}
function update(userId: string, patch: Partial<ChatRunState>) {
  states.set(userId, { ...getChatRun(userId), ...patch });
  for (const listener of listeners.get(userId) ?? []) listener();
}
const changed = (userId: string) => update(userId, { version: getChatRun(userId).version + 1 });

export async function startChatRun(userId: string, input: string, onMemoryChanged?: () => void) {
  const text = input.trim();
  if (!text || getChatRun(userId).busy) return;
  const controller = new AbortController();
  controllers.set(userId, controller);
  update(userId, { busy: true, phase: "retrieving", streaming: null, notice: null });
  try {
    const history = (await listChatMessages(userId)).slice(-10).map(({ role, content }) => ({ role, content }));
    controller.signal.throwIfAborted();
    await saveChatMessage({ id: newId(), userId, role: "user", content: text, createdAt: new Date().toISOString() });
    changed(userId);
    const { context, memories } = await prepareContext(userId, text);
    controller.signal.throwIfAborted();
    update(userId, { phase: "answering", streaming: "" });
    const reply = await streamChat({ message: text, history, context, memories },
      streaming => { if (!controller.signal.aborted) update(userId, { streaming }); }, controller.signal);
    controller.signal.throwIfAborted();
    const content = reply || "（无回复）";
    await saveChatMessage({ id: newId(), userId, role: "assistant", content,
      sources: [...new Set(context.map(chunk => chunk.docName))], createdAt: new Date().toISOString() });
    changed(userId);
    void rememberExchange(userId, text, content).then(onMemoryChanged).catch(() => undefined);
  } catch (error) {
    if (!controller.signal.aborted) update(userId, { notice: errorMessage(error) });
  } finally {
    controllers.delete(userId);
    update(userId, { busy: false, phase: null, streaming: null });
  }
}

export const stopChatRun = (userId: string) => controllers.get(userId)?.abort();
export async function clearChatHistory(userId: string) {
  if (getChatRun(userId).busy) throw new Error("正在生成回复，请先停止再清空对话");
  await clearChatMessages(userId);
  changed(userId);
}
