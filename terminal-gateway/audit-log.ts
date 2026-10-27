import fs from "node:fs/promises";
import path from "node:path";

export type AuditEvent =
  | { event: "connect"; sessionId: string; targetId: string }
  | { event: "connect_failed"; targetId: string; reason: string }
  | { event: "command"; sessionId: string; targetId: string; command: string }
  | { event: "blocked"; sessionId: string; targetId: string; command: string; reason: string }
  | { event: "disconnect"; sessionId: string; targetId: string; reason: string }
  | { event: "error"; sessionId?: string; targetId?: string; reason: string }
  | { event: "gateway_connected"; operator: string };

/** 追加一条 JSONL 审计记录（自动附加 at 时间戳）；operator 为网关鉴权得到的登录用户名 */
export async function appendAuditEvent(filePath: string, event: AuditEvent & { operator?: string }): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, JSON.stringify({ ...event, at: new Date().toISOString() }) + "\n", "utf8");
}
