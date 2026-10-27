export interface MeegleRoleOperate {
  op: "remove" | "add";
  role_key: string;
  user_keys: string[];
}

export function normalizeAssigneeUserKeys(userKeys: string[]): string[] {
  return [...new Set(userKeys.map((key) => key.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

export function buildAssigneeRoleOperate(
  roleKey: string,
  currentUserKeys: string[],
  targetUserKey: string,
): MeegleRoleOperate[] {
  const normalizedCurrent = normalizeAssigneeUserKeys(currentUserKeys);
  const normalizedTarget = targetUserKey.trim();
  if (!roleKey.trim() || !normalizedTarget) throw new Error("经办人角色或目标用户无效");
  if (normalizedCurrent.length === 1 && normalizedCurrent[0] === normalizedTarget) return [];
  return [
    ...(normalizedCurrent.length ? [{ op: "remove" as const, role_key: roleKey, user_keys: normalizedCurrent }] : []),
    { op: "add", role_key: roleKey, user_keys: [normalizedTarget] },
  ];
}
