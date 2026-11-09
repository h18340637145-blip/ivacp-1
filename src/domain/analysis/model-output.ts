/** 模型返回的占位式“无内容”回答（去掉空白、标点、括号后匹配）。 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^(空|无|暂无|略|none|empty|null|nil|na|nan|undefined|nothing|nodata|nologs?)$/,
  /^(无|暂无|没有|未找到|未发现|找不到|未检索到|未命中)(任何)?(相关|有效|匹配)?的?(信号)?(变化)?的?(日志|信息|内容|记录|数据|结果)?$/,
];

/**
 * 判断模型输出是否为有效内容：不能只是空白，或「空」「（无相关信号日志）」「(empty)」这类占位回答。
 * 同时忽略 <think> 思考段。
 */
export function isMeaningfulModelOutput(text: string | null | undefined): boolean {
  if (!text) return false;
  const visible = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const normalized = visible
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
  if (!normalized) return false;
  return !PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}
