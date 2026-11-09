import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isMeaningfulModelOutput } from "@/domain/analysis/model-output";
import { parseProtoPropertyIds } from "@/server/pipeline/signals";
import { createPipelineMetrics } from "@/server/pipeline/metrics";
import { MISSING_CAN_TRACE_NOTICE, MISSING_CAN_TRACE_REPLY } from "@/server/pipeline/constants";
import type { ProcessContext } from "@/server/pipeline/process/context";
import type { ConclusionInputs } from "@/server/pipeline/process/conclusion-stage";

const chat = vi.fn<(system: string, input: string) => Promise<string>>();
vi.mock("@/server/ai/qwen", () => ({ chat: (system: string, input: string) => chat(system, input) }));
vi.mock("@/server/ai/embeddings", () => ({ embedTexts: async () => [] }));
vi.mock("@/server/pipeline/paths-logging", () => ({ saveStepLog: async () => undefined }));
vi.mock("@/domain/analysis/few-shot-rerecall", () => ({
  recallFewShotAfterEvidence: async () => ({ samples: [], audit: { mode: "off", candidateCount: 0, degradations: [] } }),
}));

const { runFinalConclusion } = await import("@/server/pipeline/process/conclusion-stage");
const { runAndroidQnxStep } = await import("@/server/pipeline/process/log-summary-stage");
const { loadModelConfig } = await import("@/server/pipeline/process/prepare");

function makeCtx(prompts: Record<string, string> = {}) {
  const logs: string[] = [];
  const ctx = {
    logger: { log: (_stage: string, message: string) => logs.push(message) },
    metrics: createPipelineMetrics({ issueKey: "T-1", summary: "", ruleGroupId: "g", ruleGroupName: "g", carModel: "", attachRoot: "", logRoot: "" }),
    rawData: {},
    request: { prompts, issueKey: "T-1", summary: "", ruleGroupId: "g", ruleGroupName: "g" },
    issueScenePromptBlock: "",
    fewShotSamples: [],
    logRoot: "/tmp/no-such-step5-log-root",
  } as unknown as ProcessContext;
  return { ctx, logs };
}

function makeInputs(overrides: { aiUpperSummary?: string; aiAndroidQnxSummary?: string; logSignalHits?: number } = {}): ConclusionInputs {
  return {
    classified: { mode: "can_in_zip" },
    commentsText: "评论：GPS 开关设置无效",
    aiRequirements: "",
    aiSignals: "",
    aiUpperSummary: overrides.aiUpperSummary ?? "空",
    aiAndroidQnxSummary: overrides.aiAndroidQnxSummary ?? "",
    upperBundle: "评论：GPS 开关设置无效",
    canTraceText: "",
    signals: { rawSignalTokens: [], exactMatches: [], recoveredMatches: [], unmatchedTokens: [], signalIdRecords: [] },
    evidence: {
      logSignalHits: overrides.logSignalHits ?? 0,
      evidencePacketText: "{\"matchedProps\":[]}",
      canTraceExtractedResult: "",
      rawCanTracePreview: "",
      canPlotResult: {},
      reviewEvidence: { carModel: "", props: [], signalTokens: [], propertyIds: [] },
      evidencePacket: {},
    },
  } as unknown as ConclusionInputs;
}

describe("模型输出有效性", () => {
  it.each(["空", "空。", "(空)", "（无相关信号日志）", "（无信号变化日志）", "无相关日志", "(empty)", "  ", "<think>x</think>N/A"])(
    "%s 视为无效", (text) => expect(isMeaningfulModelOutput(text)).toBe(false),
  );
  it("包含实际分析内容视为有效", () => {
    expect(isMeaningfulModelOutput("无相关日志命中，但评论显示 GPS 开关下发后被 TBOX 回滚")).toBe(true);
  });
});

describe("Property ID 解析", () => {
  it("解析 type.h 的 enum class VehicleProperty，忽略注释中的短 ID", () => {
    const map = parseProtoPropertyIds([
      "/** { 注释花括号 } */",
      "enum class VehicleProperty : int32_t",
      "{",
      "    /** Undefined property.  */",
      "    INVALID = 0,",
      "    ICC_GPSSWITCHSET_509 = 557892076, // (((0xC1EC | VehiclePropertyGroup:VENDOR) | VehicleArea:GLOBAL) | VehiclePropertyType:INT32)",
      "    HEX_PROP = 0x2140C1ED // last",
      "};",
      "enum class Other { NOT_A_PROP = 1 };",
    ].join("\n"));
    expect(map.ICC_GPSSWITCHSET_509).toEqual({ decimalId: 557892076, hexId: "0X2140C1EC" });
    expect(map.HEX_PROP).toEqual({ decimalId: 557892077, hexId: "0X2140C1ED" });
    expect(map.INVALID).toEqual({ decimalId: 0, hexId: null });
    expect(map.NOT_A_PROP).toBeUndefined();
  });

  it("车型 proto 缺失时 loadModelConfig 改用 proto 目录下的 type.h", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ivacp-typeh-"));
    try {
      await fs.writeFile(path.join(dir, "type.h"), "enum class VehicleProperty : int32_t\n{\n    ICC_GPSSWITCHSET_509 = 557892076,\n};\n");
      const { ctx } = makeCtx();
      Object.assign(ctx, { analysisConfig: { carModel: "M", basePaths: { json_dir: dir, dbc_dir: dir, proto_dir: dir }, modelToFiles: { M: { json: "", dbc: "", proto: "com.bosch.cm.platform.vehicle.proto" } } } });
      const { protoContent } = await loadModelConfig(ctx);
      expect(parseProtoPropertyIds(protoContent).ICC_GPSSWITCHSET_509?.decimalId).toBe(557892076);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("保持 .proto Property_ID 的解析结果", () => {
    const map = parseProtoPropertyIds("enum Property_ID {\n    INFO_VIN = 286261504;    // 0X11100100| READ | STRING\n}");
    expect(map.INFO_VIN).toEqual({ decimalId: 286261504, hexId: "0X11100100" });
  });
});

describe("Step4 调用门槛", () => {
  beforeEach(() => chat.mockReset());
  it("日志无真实信号命中时不调用模型", async () => {
    const { ctx, logs } = makeCtx({ ANDROID_QNX_LOG_SUMMARY_SYSTEM: "分析日志" });
    const result = await runAndroidQnxStep(ctx, "BoschVehicleHalHash abc\n版本信息", "", {}, 0);
    expect(result).toBe("");
    expect(chat).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("跳过 Step4");
  });
  it("有真实命中时调用模型", async () => {
    chat.mockResolvedValue("Android 下发 GPS 开关=1");
    const { ctx } = makeCtx({ ANDROID_QNX_LOG_SUMMARY_SYSTEM: "分析日志" });
    expect(await runAndroidQnxStep(ctx, "10:01 set 557892076", "", {}, 1)).toBe("Android 下发 GPS 开关=1");
  });
});

describe("Step5 无 CAN trace 混合兜底", () => {
  beforeEach(() => chat.mockReset());

  it("Step3 为「空」且无日志命中时输出固定补件结论，不把「空」当结论", async () => {
    const { ctx } = makeCtx();
    const reply = await runFinalConclusion(ctx, makeInputs({ aiUpperSummary: "空", aiAndroidQnxSummary: "（无相关信号日志）" }));
    expect(reply).toBe(MISSING_CAN_TRACE_REPLY);
    expect(chat).not.toHaveBeenCalled();
  });

  it("有日志命中时用摘要提示词生成结论并标注缺 CAN trace", async () => {
    chat.mockResolvedValue("Android 已下发 GPS 开关，TBOX 未响应");
    const { ctx } = makeCtx();
    const reply = await runFinalConclusion(ctx, makeInputs({ logSignalHits: 3, aiAndroidQnxSummary: "Android 下发 GPS 开关=1" }));
    expect(reply.startsWith(MISSING_CAN_TRACE_NOTICE)).toBe(true);
    expect(reply).toContain("Android 已下发 GPS 开关，TBOX 未响应");
    expect(reply).toContain("CAN trace");
    const input = chat.mock.calls[0][1];
    expect(input).toContain("<证据缺口>");
    expect(input).toContain("<Android+QNX日志摘要>");
    expect(input).toContain("<结构化证据包>");
  });

  it("摘要结论仍无效时改为固定补件结论", async () => {
    chat.mockResolvedValue("空。");
    const { ctx } = makeCtx();
    const reply = await runFinalConclusion(ctx, makeInputs({ aiUpperSummary: "评论显示设置后 3 秒回弹" }));
    expect(reply).toBe(MISSING_CAN_TRACE_REPLY);
  });
});
