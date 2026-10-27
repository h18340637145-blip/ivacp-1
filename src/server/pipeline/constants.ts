

export const CAN_SUFFIXES = [".asc", ".blf"];

export const ZIP_SUFFIXES = [".zip", ".rar", ".7z", ".tgz", ".tar.gz",
  ".zip.001", ".rar.001", ".7z.001"];

export const ARCHIVE_SUFFIXES = [
  ".tar.gz",
  ".tgz",
  ".tar",
  ".zip",
  ".rar",
  ".7z",
  ".zip.001",
  ".rar.001",
  ".7z.001",
  ".gz",
  ".zst",
];

export const MAX_DIFF_SECONDS = 7200;       // 2h: CAN newer → can_only

export const MIN_DIFF_SECONDS = 5400;       // 90min: both within range → both

export const MEEGLE_MISSING_ANALYSIS_ATTACHMENTS_REPLY = "车控车设问题分析需要CAN trace，请复测并提取问题发生时的Android log, QNX log, CAN trace，依次从应用->Framework再转给VHAL分析，谢谢";

export const MAX_LOG_CHARS    = 12_000;     // per-section cap: ~8 000 tokens each

export const MAX_CAN_CHARS    = 12_000;     // CAN trace cap

export const MAX_COMMENTS_CHARS = 8_000;   // comments + description cap

export const QWEN_CONTEXT_TOKENS = 40_960;

export const QWEN_OUTPUT_RESERVE_TOKENS = 4_096;

export const STEP5_PROMPT_TOKEN_BUDGET = Math.min(30_000, QWEN_CONTEXT_TOKENS - QWEN_OUTPUT_RESERVE_TOKENS);

export const MAX_STEP5_CAN_SUMMARY_CHARS = 18_000;

export const MAX_STEP5_RAW_CAN_CHARS = 4_000;

/** Minimum protected size (chars) for the CAN Trace 提取结果 evidence section. */
export const MIN_STEP5_CAN_SUMMARY_CHARS = 12_000;

/** Low temperature stabilizes the final conclusion (less run-to-run variance). */
export const STEP5_TEMPERATURE = 0.1;

/** Number of independent samples drawn for high-priority self-consistency voting. */
export const STEP5_SELF_CONSISTENCY_SAMPLES = 3;

/** Slightly higher temperature to diversify self-consistency candidates. */
export const STEP5_SELF_CONSISTENCY_TEMPERATURE = 0.3;

/** Structured-output constraint appended to every Step 5 system prompt. */
export const STEP5_OUTPUT_CONSTRAINT = [
  "",
  "---",
  "请严格按以下结构输出分析结论：",
  "1. 【现象】：一句话概括问题现象。",
  "2. 【证据】：逐条列出支撑结论的具体信号值、报文 ID、时间戳或日志行；每条证据必须来自上文提供的 CAN Trace 提取结果、信号配置或日志，禁止凭空编造。",
  "优先引用 `<结构化证据包>` 中的 matchedProps、signalIntervals、logHits、missingEvidence 和 riskFlags；如果证据包标记缺失证据，必须降低置信度并说明缺失项。",
  "若 `timeWindow.suspectedClockOffsetHours` 存在，说明上层日志与 CAN trace 时钟存在整小时偏差（常见 UTC 与北京时间相差 8 小时）：应将上层时间减去该小时数后再与 CAN 信号对齐分析，不要仅因时间窗不重叠就判定无法分析，并在【证据】中注明该对齐假设。",
  "3. 【根因】：基于证据推断的根本原因。",
  "4. 【结论】：明确的处理判断或建议。",
  "5. 【置信度】：高 / 中 / 低。若证据不足以支撑明确结论，必须标注为“低”，并指出缺失的关键证据。",
  "注意：禁止虚构上文未出现的信号、报文或时间；若某项无法判断，请如实写“证据不足”。",
].join("\n");

export const DEFAULT_LOG_SUMMARY = `你是一名专业的汽车嵌入式软件缺陷分析工程师，专注于 CAN 总线通信、AUTOSAR 架构和车载控制器软件。
根据提供的 Jira 工单信息和评论，给出结构化的缺陷分析报告，包含：
## 工单摘要
## 根因分析
## 建议处理措施
## 置信度（高/中/低，说明理由）`;

/* ─── Jira HTTP helper ───────────────────────────────────────────────────── */
