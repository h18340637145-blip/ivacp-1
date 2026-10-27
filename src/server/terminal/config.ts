/** 远程终端目标配置（REMOTE_SHELL_TARGETS_JSON）：服务端与 terminal-gateway 共用；错误消息保持英文以便日志检索 */
import type { PublicRemoteShellTarget, RemoteShellTarget } from "@/domain/terminal/types";

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`REMOTE_SHELL_TARGETS_JSON invalid: ${field} is required`);
  }
  return value.trim();
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`REMOTE_SHELL_TARGETS_JSON invalid: ${field} must be a positive integer`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`REMOTE_SHELL_TARGETS_JSON invalid: ${field} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function parseRemoteShellTargets(raw: string | undefined): RemoteShellTarget[] {
  if (!raw?.trim()) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("REMOTE_SHELL_TARGETS_JSON invalid: root must be an array");
  }

  return parsed.map((item, index) => {
    const record = item as Record<string, unknown>;
    const id = requireString(record.id, `target[${index}].id`);
    const name = requireString(record.name, `target[${index}].name`);
    const description = requireString(record.description, `target[${index}].description`);
    const environment = requireString(record.environment, `target[${index}].environment`);
    const guardMode = requireString(record.guardMode, `target[${index}].guardMode`);
    if (guardMode !== "soft" && guardMode !== "strict") {
      throw new Error(`REMOTE_SHELL_TARGETS_JSON invalid: target[${index}].guardMode`);
    }
    const riskLevel = requireString(record.riskLevel, `target[${index}].riskLevel`);
    if (riskLevel !== "normal" && riskLevel !== "critical") {
      throw new Error(`REMOTE_SHELL_TARGETS_JSON invalid: target[${index}].riskLevel`);
    }

    const privateKeyPath = optionalString(record.privateKeyPath, `target[${index}].privateKeyPath`);
    const privateKeyPassphrase = optionalString(record.privateKeyPassphrase, `target[${index}].privateKeyPassphrase`);
    const password = optionalString(record.password, `target[${index}].password`);
    const agentSocket = optionalString(record.agentSocket, `target[${index}].agentSocket`);
    if (!privateKeyPath && !password && !agentSocket) {
      throw new Error(`REMOTE_SHELL_TARGETS_JSON invalid: target[${index}].authentication requires privateKeyPath, password, or agentSocket`);
    }

    return {
      id,
      name,
      description,
      environment,
      riskLevel,
      guardMode,
      host: requireString(record.host, `target[${index}].host`),
      port: requireNumber(record.port, `target[${index}].port`),
      username: requireString(record.username, `target[${index}].username`),
      privateKeyPath,
      privateKeyPassphrase,
      password,
      agentSocket,
      strictAllowlist: Array.isArray(record.strictAllowlist)
        ? record.strictAllowlist.filter((v): v is string => typeof v === "string" && v.trim() !== "")
        : undefined,
    };
  });
}

export function toPublicTarget(target: RemoteShellTarget): PublicRemoteShellTarget {
  return {
    id: target.id,
    name: target.name,
    description: target.description,
    environment: target.environment,
    riskLevel: target.riskLevel,
    guardMode: target.guardMode,
  };
}

export function loadRemoteShellTargets(): RemoteShellTarget[] {
  return parseRemoteShellTargets(process.env.REMOTE_SHELL_TARGETS_JSON);
}
