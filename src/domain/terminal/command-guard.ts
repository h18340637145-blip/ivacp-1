import type { RemoteShellGuardMode } from "./types";

interface GuardOptions {
  guardMode: RemoteShellGuardMode;
  strictAllowlist?: string[];
}

export interface CommandGuardResult {
  allowed: boolean;
  reason?: "blocked_by_soft_guard" | "blocked_by_strict_guard";
}

const SOFT_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-rf|-fr)\s+\/(?:\s|$|\*)/,
  /^\s*(reboot|shutdown|halt|poweroff)(\s|$)/,
  /^\s*mkfs(\.| |\t|$)/,
  /:\s*\(\)\s*\{\s*:\|:&\s*\};\s*:/,
];

const STRICT_COMMANDS = new Set([
  "rm",
  "dd",
  "mkfs",
  "mount",
  "umount",
  "systemctl",
  "service",
  "sudo",
  "su",
  "reboot",
  "shutdown",
  "halt",
  "poweroff",
]);

function firstCommand(input: string): string {
  return input.trim().split(/\s+/)[0] ?? "";
}

export function checkCommandAllowed(input: string, options: GuardOptions): CommandGuardResult {
  const command = input.trim();
  if (!command) return { allowed: true };

  if (options.guardMode === "soft") {
    return SOFT_PATTERNS.some((pattern) => pattern.test(command))
      ? { allowed: false, reason: "blocked_by_soft_guard" }
      : { allowed: true };
  }

  if (options.strictAllowlist?.includes(command)) {
    return { allowed: true };
  }

  return STRICT_COMMANDS.has(firstCommand(command))
    ? { allowed: false, reason: "blocked_by_strict_guard" }
    : { allowed: true };
}
