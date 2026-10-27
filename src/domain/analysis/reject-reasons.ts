/** 人工驳回的结构化原因：用于统计错误分布、按错误类型检索 few-shot 与生成复核要点 */
export const REJECT_REASON_CODES = [
  "signal_missed",
  "timing_misjudged",
  "conclusion_overreach",
  "log_missing",
  "module_misrouted",
  "other",
] as const;

export type RejectReasonCode = (typeof REJECT_REASON_CODES)[number];

export interface RejectReasonInfo {
  label: string;
  /** 选择时给复核人的说明 */
  hint: string;
  /** 注入提示词的复核要点：看到这类历史错误时应当怎样自查 */
  checklist: string;
}

export const REJECT_REASONS: Record<RejectReasonCode, RejectReasonInfo> = {
  signal_missed: {
    label: "信号漏提",
    hint: "漏掉或误识别了关键信号 / 属性",
    checklist: "逐个核对需求与日志涉及的信号、属性 ID 是否都出现在证据包的匹配结果中，未匹配的信号要明确说明，不要忽略。",
  },
  timing_misjudged: {
    label: "时序误判",
    hint: "信号先后顺序、时间偏移、周期或超时判断错误",
    checklist: "以 CAN Trace 的时间戳为准判断先后与间隔，注意日志与 CAN 之间的时钟偏移，不要凭描述顺序推断时序。",
  },
  conclusion_overreach: {
    label: "结论过度",
    hint: "没有证据支撑却下了确定结论或归责",
    checklist: "每条断言都要能在证据包、CAN 摘要或日志摘录中找到原文；证据不足时写“证据不足”并说明缺什么，不要臆测责任方。",
  },
  log_missing: {
    label: "缺日志",
    hint: "关键日志缺失或不完整，导致无法判断",
    checklist: "先检查所需日志是否齐全（时间窗口、模块、附件）；缺失时明确列出缺少的日志并建议补充，而不是给出确定结论。",
  },
  module_misrouted: {
    label: "模块转错",
    hint: "责任模块或转派对象判断错误",
    checklist: "转派前对照规则组的模块划分与历史转派结论，先排除对手件 / VHAL 等上下游，再给出责任模块。",
  },
  other: {
    label: "其他",
    hint: "以上都不符合，请在补充说明里写清楚",
    checklist: "",
  },
};

export function isRejectReasonCode(value: unknown): value is RejectReasonCode {
  return typeof value === "string" && (REJECT_REASON_CODES as readonly string[]).includes(value);
}

export function rejectReasonLabel(code: RejectReasonCode): string {
  return REJECT_REASONS[code].label;
}

// 顺序有意义：先匹配更具体的类型
const LEGACY_PATTERNS: Array<[RejectReasonCode, RegExp]> = [
  ["log_missing", /缺(少|失)?日志|无日志|没有日志|日志(缺|不全|不完整)/],
  ["module_misrouted", /转(给|错|到)|模块|责任(方|模块)?|对手件|VHAL/i],
  ["signal_missed", /漏提|遗漏|未(提取|识别)|没有(提取|识别)|信号.{0,6}(缺|漏)/],
  ["timing_misjudged", /时序|时间(戳|偏移|差)?|先后|顺序|延迟|偏移|超时|周期/],
  ["conclusion_overreach", /过度|臆测|猜测|武断|无证据|没有证据|证据不足|不应(该)?(下|给)/],
];

/** 从历史自由文本推断类型；无法判断返回 undefined */
export function inferRejectReasonCode(text: string | undefined): RejectReasonCode | undefined {
  const value = text?.trim();
  if (!value) return undefined;
  return LEGACY_PATTERNS.find(([, pattern]) => pattern.test(value))?.[0];
}

/** 历史数据没有结构化字段：先用已存类型，再用文本推断，最后归为“其他” */
export function effectiveRejectReasonCode(input: {
  errorCategory?: unknown;
  errorReason?: string;
}): RejectReasonCode {
  if (isRejectReasonCode(input.errorCategory)) return input.errorCategory;
  return inferRejectReasonCode(input.errorReason) ?? "other";
}

/** 复核界面提交前校验；失败抛中文错误 */
export function validateRejectInput(input: {
  category: unknown;
  detail: string;
  correctResult: string;
}): { category: RejectReasonCode; detail: string; correctResult: string } {
  if (!isRejectReasonCode(input.category)) throw new Error("请选择驳回原因类型");
  const detail = input.detail.trim();
  const correctResult = input.correctResult.trim();
  if (input.category === "other" && !detail) throw new Error("选择“其他”时必须填写补充说明");
  if (!correctResult) throw new Error("正确结论不能为空");
  return { category: input.category, detail, correctResult };
}

/** 存入 errorReason 的展示文本：类型标签 + 补充说明 */
export function formatRejectReason(category: RejectReasonCode, detail: string): string {
  const label = rejectReasonLabel(category);
  const trimmed = detail.trim();
  return trimmed ? `【${label}】${trimmed}` : `【${label}】`;
}

/** 解析已存储的 errorReason（`【标签】补充说明`），用于编辑时回填；历史文本整体视为补充说明 */
export function parseRejectReason(text: string | undefined, category?: unknown): { category?: RejectReasonCode; detail: string } {
  const value = text?.trim() ?? "";
  const match = /^【([^】]+)】([\s\S]*)$/.exec(value);
  if (match) {
    const code = REJECT_REASON_CODES.find((item) => REJECT_REASONS[item].label === match[1]);
    if (code) return { category: isRejectReasonCode(category) ? category : code, detail: match[2].trim() };
  }
  return { category: isRejectReasonCode(category) ? category : inferRejectReasonCode(value), detail: value };
}

export interface ErrorPattern {
  code: RejectReasonCode;
  label: string;
  count: number;
  /** 占该范围内全部纠错样本的比例（0-1） */
  share: number;
  checklist: string;
  scope: "car_model" | "rule_group";
}

export interface ErrorPatternSample {
  sampleKind?: "correction" | "approved";
  carModel?: string;
  errorCategory?: unknown;
  errorReason?: string;
}

export const MIN_SAMPLES_FOR_PATTERNS = 3;

/** 各错误类型在纠错样本中的占比，供检索排序做先验；样本不足返回空对象 */
export function categoryShares(
  samples: ErrorPatternSample[],
  carModel?: string,
): Partial<Record<RejectReasonCode, number>> {
  const corrections = samples.filter((sample) => sample.sampleKind !== "approved");
  const model = carModel?.trim().toLowerCase();
  const sameModel = model ? corrections.filter((sample) => sample.carModel?.trim().toLowerCase() === model) : [];
  const scoped = sameModel.length >= MIN_SAMPLES_FOR_PATTERNS ? sameModel : corrections;
  if (scoped.length < MIN_SAMPLES_FOR_PATTERNS) return {};
  const shares: Partial<Record<RejectReasonCode, number>> = {};
  for (const sample of scoped) {
    const code = effectiveRejectReasonCode(sample);
    shares[code] = (shares[code] ?? 0) + 1 / scoped.length;
  }
  return shares;
}

/**
 * 汇总历史错误类型。同车型纠错样本不少于 3 条时只看该车型，否则看整个规则组；
 * 样本太少时返回空，避免用噪声误导模型。
 */
export function summarizeErrorPatterns(
  samples: ErrorPatternSample[],
  options: { carModel?: string; maxPatterns?: number } = {},
): ErrorPattern[] {
  const corrections = samples.filter((sample) => sample.sampleKind !== "approved");
  const model = options.carModel?.trim().toLowerCase();
  const sameModel = model ? corrections.filter((sample) => sample.carModel?.trim().toLowerCase() === model) : [];
  const useModel = sameModel.length >= MIN_SAMPLES_FOR_PATTERNS;
  const scoped = useModel ? sameModel : corrections;
  if (scoped.length < MIN_SAMPLES_FOR_PATTERNS) return [];

  const counts = new Map<RejectReasonCode, number>();
  for (const sample of scoped) {
    const code = effectiveRejectReasonCode(sample);
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([code]) => code !== "other")
    .sort((a, b) => b[1] - a[1] || REJECT_REASON_CODES.indexOf(a[0]) - REJECT_REASON_CODES.indexOf(b[0]))
    .slice(0, options.maxPatterns ?? 3)
    .map(([code, count]) => ({
      code,
      label: rejectReasonLabel(code),
      count,
      share: count / scoped.length,
      checklist: REJECT_REASONS[code].checklist,
      scope: useModel ? "car_model" : "rule_group",
    }));
}
