import { callQwen } from "@/server/ai/qwen";
import { parseCandidates, parseDecision, type Decision, type MemoryCandidate } from "@/domain/knowledge/memory-core";
import { stripThink } from "./stream-text";

const EXTRACT_PROMPT =
  '从对话中抽取关于用户的长期记忆（稳定事实、偏好、目标、重要事件），忽略闲聊和临时信息。只输出 JSON：{"memories":[{"content":"一句话，以“用户”开头","type":"fact|preference|episode","importance":0到1}]}；没有值得记忆的内容时输出 {"memories":[]}。';

const DECIDE_PROMPT =
  '判断新记忆与已有记忆的关系。重复则 {"action":"NOOP"}；是对某条已有记忆的更新或补充则 {"action":"UPDATE","index":序号,"content":"合并后的完整表述"}；否则 {"action":"ADD"}。只输出 JSON。';

/** 从一轮对话中抽取长期记忆候选 */
export async function extractMemories(user: string, assistant: string): Promise<MemoryCandidate[]> {
  const raw = await callQwen(
    [
      { role: "system", content: EXTRACT_PROMPT },
      { role: "user", content: `用户：${user.slice(0, 4000)}\n助手：${assistant.slice(0, 4000)}` },
    ],
    { temperature: 0 },
  );
  return parseCandidates(stripThink(raw));
}

/** 判断候选记忆与近邻记忆的关系：ADD / NOOP / UPDATE */
export async function decideMemory(candidate: string, neighbours: string[]): Promise<Decision> {
  const list = neighbours.slice(0, 5).map((n) => n.slice(0, 300));
  const raw = await callQwen(
    [
      { role: "system", content: DECIDE_PROMPT },
      {
        role: "user",
        content: `已有记忆：\n${list.map((n, i) => `[${i}] ${n}`).join("\n")}\n\n新记忆：${candidate.slice(0, 300)}`,
      },
    ],
    { temperature: 0 },
  );
  return parseDecision(stripThink(raw), list.length);
}
