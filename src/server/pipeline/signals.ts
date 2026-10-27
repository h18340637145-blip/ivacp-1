import { trackPipelineChild, throwIfPipelineCancelled } from "./process/runtime";
import { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { chat } from "@/server/ai/qwen";
import { normalizeReviewSampleKind } from "@/domain/analysis/review-sample";
import { PipelineLogger, saveStepLog } from "@/server/pipeline/paths-logging";
import { FewShotSample, ModelSignalConfigEntry, PlotResult, SignalCandidate, SignalConfigMatch, SignalIdRecord } from "@/server/pipeline/types";

export const PLOT_BIN = "node";

export const PLOT_SCRIPT = path.join(process.cwd(), "scripts", "plot_can_signals.js");

export const MAX_SIGNAL_CANDIDATES = 40;

export const SIGNAL_TOKEN_STOP_WORDS = new Set([
  "ANALYSIS",
  "ANDROID",
  "BECAUSE",
  "COMMENT",
  "CONFIG",
  "CURRENT",
  "DESCRIBE",
  "DESCRIPTION",
  "EXPECTED",
  "FAILED",
  "FAULT",
  "FOUND",
  "ISSUE",
  "JIRA",
  "MODEL",
  "NORMAL",
  "OBSERVED",
  "PROBLEM",
  "REASON",
  "RESULT",
  "SIGNAL",
  "SIGNALS",
  "STATUS",
  "SUMMARY",
  "TRACE",
  "VALUE",
  "VEHICLE",
]);

/**
 * Call Python script to decode & plot CAN signals from ASC/BLF file.
 * Returns { image, summary, error }.
 */
export async function plotCanSignals(
  tracePath: string,
  dbcPaths: string[],
  signalNames: string[],
  outputPng: string,
): Promise<PlotResult> {
  throwIfPipelineCancelled();
  const validDbcs = dbcPaths.filter((p) => p);
  if (!validDbcs.length || !signalNames.length || !tracePath) {
    return { image: "", summary: "", error: "Missing DBC/signals/CAN trace" };
  }

  const args = [
    PLOT_SCRIPT,
    "--trace", tracePath,
    ...validDbcs.flatMap((d) => ["--dbc", d]),
    "--signals", signalNames.join(","),
    "--output", outputPng,
  ];

  return new Promise((resolve) => {
    const proc = spawn(PLOT_BIN, args, {
      detached: process.platform !== "win32",
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    trackPipelineChild(proc);
    let stdout = "";
    let stderr = "";
    proc.stdout!.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr!.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) {
        resolve({ image: "", summary: "", error: `Plot script exit ${code}: ${stderr.slice(0, 200)}` });
        return;
      }
      try {
        const result = JSON.parse(stdout.trim());
        resolve(result as PlotResult);
      } catch {
        resolve({ image: "", summary: "", error: `Invalid JSON output: ${stdout.slice(0, 200)}` });
      }
    });

    proc.on("error", (err) => {
      resolve({ image: "", summary: "", error: `Spawn error: ${err.message}` });
    });
  });
}

export async function findMaxCycleDir(dir: string): Promise<string | null> {
  let maxCycleNum = -1;
  let maxCyclePath: string | null = null;

  async function walk(currentDir: string) {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        const fullPath = path.join(currentDir, e.name);
        const match = e.name.match(/^cycle_(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxCycleNum) {
            maxCycleNum = num;
            maxCyclePath = fullPath;
          }
        }
        await walk(fullPath);
      }
    }
  }

  await walk(dir);
  return maxCyclePath;
}

export function isSupportedCanTrace(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith(".asc") || lower.endsWith(".blf");
}

export async function awaitCanSignalExtraction(
  plotPromise: Promise<PlotResult> | null,
  logger: PipelineLogger,
  logRoot: string,
): Promise<PlotResult> {
  if (!plotPromise) {
    return { image: "", summary: "", error: "" };
  }

  try {
    const result = await plotPromise;
    if (result.image) {
      logger.log("PLOTTING", `信号图生成成功: ${path.basename(result.image)}`);
    } else if (result.error) {
      logger.log("PLOTTING", `信号图生成失败: ${result.error}`);
    } else {
      logger.log("PLOTTING", "信号图为空（CAN trace 中未找到目标信号数据）");
    }

    if (result.summary) {
      await saveStepLog(logRoot, "can_signal_summary.txt", result.summary);
      await saveStepLog(logRoot, "can_trace_extracted_result.txt", result.summary);
      logger.log("PLOTTING", `CAN trace 提取后结果已生成，${result.summary.length} 字符`);
    }

    return result;
  } catch (e) {
    const error = `绘图异常: ${String(e).slice(0, 100)}`;
    logger.log("PLOTTING", error);
    return { image: "", summary: "", error };
  }
}

export function normalizeSignalToken(value: string): string {
  return value.trim().replace(/^[-*•\d.()\s]+/, "").toUpperCase();
}

export function parseStep2SignalTokens(text: string): string[] {
  const tokens = new Set<string>();
  const matches = text.match(/[A-Za-z][A-Za-z0-9_]+/g) ?? [];
  for (const token of matches) {
    const normalized = normalizeSignalToken(token);
    if (normalized.length >= 2) {
      tokens.add(token.trim());
    }
  }
  return Array.from(tokens);
}

export function hasSignalTokenShape(token: string): boolean {
  const hasPascalCase = /^[A-Z]+[a-z]+(?:[A-Z][a-z0-9]*)*$/.test(token);
  return /_/.test(token) || /\d/.test(token) || /[a-z][A-Z]/.test(token) || hasPascalCase;
}

export function isLikelySignalCandidate(token: string, source: SignalCandidate["sources"][number]): boolean {
  const trimmed = token.trim();
  const normalized = normalizeSignalToken(trimmed);
  if (normalized.length < 4) return false;
  if (SIGNAL_TOKEN_STOP_WORDS.has(normalized)) return false;
  if (source === "config_prop" || source === "config_signal") return true;
  return hasSignalTokenShape(trimmed);
}

export function addSignalCandidate(
  map: Map<string, SignalCandidate>,
  token: string,
  source: SignalCandidate["sources"][number],
  weight: number,
): void {
  const normalized = normalizeSignalToken(token);
  if (!isLikelySignalCandidate(token, source)) return;
  const existing = map.get(normalized) ?? { token: token.trim(), normalized, sources: [], weight: 0 };
  if (!existing.sources.includes(source)) existing.sources.push(source);
  existing.weight = Math.max(existing.weight, weight);
  map.set(normalized, existing);
}

export function annotateCandidateSourceIfExists(
  map: Map<string, SignalCandidate>,
  token: string,
  source: SignalCandidate["sources"][number],
  weight: number,
): void {
  const normalized = normalizeSignalToken(token);
  const existing = map.get(normalized);
  if (!existing) return;
  if (!existing.sources.includes(source)) existing.sources.push(source);
  existing.weight = Math.max(existing.weight, weight);
}

export function collectTextSignalCandidates(
  text: string,
  source: SignalCandidate["sources"][number],
  weight: number,
  map: Map<string, SignalCandidate>,
): void {
  for (const token of parseStep2SignalTokens(text)) {
    addSignalCandidate(map, token, source, weight);
  }
}

export function buildSignalCandidatePool(args: {
  step2Text: string;
  summary: string;
  description?: string;
  commentsText: string;
  configItems: ModelSignalConfigEntry[];
  fewShotSamples?: FewShotSample[];
}): SignalCandidate[] {
  const map = new Map<string, SignalCandidate>();
  collectTextSignalCandidates(args.step2Text, "step2", 1, map);
  collectTextSignalCandidates(args.summary, "jira_summary", 0.8, map);
  collectTextSignalCandidates(args.description ?? "", "jira_description", 0.7, map);
  collectTextSignalCandidates(args.commentsText, "jira_comment", 0.7, map);

  for (const sample of args.fewShotSamples ?? []) {
    if (normalizeReviewSampleKind(sample) === "approved") continue;
    collectTextSignalCandidates(
      [
        sample.issueSummary,
        sample.wrongConclusion,
        sample.correctConclusion,
        sample.approvedConclusion,
        ...(sample.props ?? []),
        ...(sample.signalTokens ?? []),
        ...(sample.propertyIds ?? []),
      ].join("\n"),
      "few_shot",
      0.5,
      map,
    );
  }

  for (const item of args.configItems) {
    if (item.prop) annotateCandidateSourceIfExists(map, String(item.prop), "config_prop", 0.6);
    for (const signal of collectSignalsFromConfigItem(item)) {
      annotateCandidateSourceIfExists(map, signal, "config_signal", 0.6);
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_SIGNAL_CANDIDATES);
}

export function collectSignalsFromConfigItem(item: ModelSignalConfigEntry): string[] {
  const signals = new Set<string>();
  for (const cfg of item.config ?? []) {
    for (const signal of cfg.setSignals ?? []) {
      if (signal) signals.add(signal);
    }
    for (const signal of cfg.getSignals ?? []) {
      if (signal) signals.add(signal);
    }
  }
  return Array.from(signals);
}

export function buildSignalConfigMatches(
  configItems: ModelSignalConfigEntry[],
  rawTokens: string[],
): SignalConfigMatch[] {
  const propIndex = new Map<string, ModelSignalConfigEntry>();
  const getSignalIndex = new Map<string, Array<{ item: ModelSignalConfigEntry; signal: string }>>();
  const setSignalIndex = new Map<string, Array<{ item: ModelSignalConfigEntry; signal: string }>>();

  for (const item of configItems) {
    const prop = String(item.prop ?? "").trim();
    if (!prop) continue;
    propIndex.set(normalizeSignalToken(prop), item);

    for (const cfg of item.config ?? []) {
      for (const signal of cfg.getSignals ?? []) {
        const key = normalizeSignalToken(signal);
        const list = getSignalIndex.get(key) ?? [];
        list.push({ item, signal });
        getSignalIndex.set(key, list);
      }
      for (const signal of cfg.setSignals ?? []) {
        const key = normalizeSignalToken(signal);
        const list = setSignalIndex.get(key) ?? [];
        list.push({ item, signal });
        setSignalIndex.set(key, list);
      }
    }
  }

  const matches: SignalConfigMatch[] = [];
  const seen = new Set<string>();

  for (const token of rawTokens) {
    const normalized = normalizeSignalToken(token);
    const propItem = propIndex.get(normalized);
    if (propItem?.prop) {
      const key = `${normalized}|prop|${propItem.prop}`;
      if (!seen.has(key)) {
        seen.add(key);
        matches.push({
          sourceToken: token,
          matchedBy: "prop",
          matchedSignal: null,
          prop: String(propItem.prop),
          access: propItem.access,
          configItem: propItem,
        });
      }
    }

    for (const entry of getSignalIndex.get(normalized) ?? []) {
      if (!entry.item.prop) continue;
      const key = `${normalized}|getSignal|${entry.item.prop}|${entry.signal}`;
      if (!seen.has(key)) {
        seen.add(key);
        matches.push({
          sourceToken: token,
          matchedBy: "getSignal",
          matchedSignal: entry.signal,
          prop: String(entry.item.prop),
          access: entry.item.access,
          configItem: entry.item,
        });
      }
    }

    for (const entry of setSignalIndex.get(normalized) ?? []) {
      if (!entry.item.prop) continue;
      const key = `${normalized}|setSignal|${entry.item.prop}|${entry.signal}`;
      if (!seen.has(key)) {
        seen.add(key);
        matches.push({
          sourceToken: token,
          matchedBy: "setSignal",
          matchedSignal: entry.signal,
          prop: String(entry.item.prop),
          access: entry.item.access,
          configItem: entry.item,
        });
      }
    }
  }

  return matches;
}

export function normalizedEditDistance(a: string, b: string): number {
  const s = a.toUpperCase();
  const t = b.toUpperCase();
  const m = s.length;
  const n = t.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) dp[j] = j;
  for (let i = 1; i <= m; i += 1) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const tmp = dp[j];
      dp[j] = s[i - 1] === t[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

/**
 * 对精确未命中的 token 做模糊/子串补救。每 token 至多取 1 个最佳候选。
 * 命中条件：编辑距离 ≤ 2 且 ≤ 15% 较长串长度；或一方为另一方子串（缩写场景，长度 ≥ 4）。
 */
export function recoverFuzzyMatches(
  configItems: ModelSignalConfigEntry[],
  unmatchedTokens: string[],
): SignalConfigMatch[] {
  const candidates: Array<{ prop: string; key: string; item: ModelSignalConfigEntry }> = [];
  for (const item of configItems) {
    const prop = String(item.prop ?? "").trim();
    if (!prop) continue;
    candidates.push({ prop, key: normalizeSignalToken(prop), item });
  }

  const recovered: SignalConfigMatch[] = [];
  for (const token of unmatchedTokens) {
    const normToken = normalizeSignalToken(token);
    if (normToken.length < 4) continue; // 太短易误配
    let best: { prop: string; item: ModelSignalConfigEntry; similarity: number } | null = null;
    for (const cand of candidates) {
      const maxLen = Math.max(normToken.length, cand.key.length);
      const minLen = Math.min(normToken.length, cand.key.length);
      const distance = normalizedEditDistance(normToken, cand.key);
      const withinEdit = distance <= 2 && distance <= maxLen * 0.15;
      const isSubstring =
        cand.key.length >= 4 &&
        minLen >= maxLen * 0.6 && // 长度比下限，避免短词根撞长 prop
        (cand.key.includes(normToken) || normToken.includes(cand.key));
      if (!withinEdit && !isSubstring) continue;
      const similarity = 1 - distance / maxLen;
      if (!best || similarity > best.similarity) {
        best = { prop: cand.prop, item: cand.item, similarity };
      }
    }
    if (best) {
      recovered.push({
        sourceToken: token,
        matchedBy: "fuzzy",
        matchedSignal: null,
        prop: best.prop,
        access: best.item.access,
        configItem: best.item,
        similarity: Number(best.similarity.toFixed(3)),
        recoveryReason: `edit_or_substring_similarity_${Number(best.similarity.toFixed(3))}`,
      });
    }
  }
  return recovered;
}

/**
 * U2b：对仍未命中的 token 做一次受限 LLM 自检。
 * 模型只能从候选 prop 列表中选或答 null，禁止编造。失败静默跳过。
 */
export async function recoverViaSelfCheck(
  configItems: ModelSignalConfigEntry[],
  unmatchedTokens: string[],
  logger: { log: (stage: string, msg: string) => void },
): Promise<SignalConfigMatch[]> {
  if (unmatchedTokens.length === 0) return [];
  const propByNorm = new Map<string, ModelSignalConfigEntry>();
  const candidateProps: string[] = [];
  for (const item of configItems) {
    const prop = String(item.prop ?? "").trim();
    if (!prop) continue;
    const norm = normalizeSignalToken(prop);
    if (!propByNorm.has(norm)) {
      propByNorm.set(norm, item);
      candidateProps.push(prop);
    }
  }
  if (candidateProps.length === 0) return [];

  const MAX_CANDIDATES = 200;
  let shortlisted = candidateProps;
  if (candidateProps.length > MAX_CANDIDATES) {
    const scored = candidateProps.map((prop) => {
      const key = normalizeSignalToken(prop);
      const best = Math.max(
        ...unmatchedTokens.map((tok) => {
          const nt = normalizeSignalToken(tok);
          const maxLen = Math.max(nt.length, key.length) || 1;
          return 1 - normalizedEditDistance(nt, key) / maxLen;
        }),
      );
      return { prop, score: best };
    });
    scored.sort((a, b) => b.score - a.score);
    shortlisted = scored.slice(0, MAX_CANDIDATES).map((s) => s.prop);
  }

  const systemPrompt =
    "你是车载信号配置匹配助手。给定一批待匹配 token 与候选 prop 列表，" +
    "为每个 token 选出语义最接近的 prop，只能从候选列表中选；" +
    "若无任何合理对应必须返回 null，严禁编造候选列表之外的值。" +
    "只输出 JSON 数组，每项形如 {\"token\":\"\",\"matchedProp\":\"\"|null,\"reason\":\"\"}。";
  const userContent =
    `待匹配 token：\n${unmatchedTokens.join(", ")}\n\n候选 prop：\n${shortlisted.join(", ")}`;

  let raw = "";
  try {
    raw = await chat(systemPrompt, userContent, { temperature: 0.1 });
  } catch (e) {
    logger.log("AI_STEP2", `U2b 自检调用失败，跳过：${String(e).slice(0, 120)}`);
    return [];
  }

  const allowed = new Set(shortlisted.map((p) => normalizeSignalToken(p)));
  const recovered: SignalConfigMatch[] = [];
  try {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) return [];
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Array<{ token?: string; matchedProp?: string | null }>;
    for (const entry of parsed) {
      const token = String(entry.token ?? "").trim();
      const matchedProp = entry.matchedProp;
      if (!token || !matchedProp) continue;
      const norm = normalizeSignalToken(matchedProp);
      if (!allowed.has(norm)) continue;
      const item = propByNorm.get(norm);
      if (!item) continue;
      recovered.push({
        sourceToken: token,
        matchedBy: "self_check",
        matchedSignal: null,
        prop: String(item.prop),
        access: item.access,
        configItem: item,
        recoveryReason: "restricted_llm_self_check",
      });
    }
  } catch (e) {
    logger.log("AI_STEP2", `U2b 自检结果解析失败，跳过：${String(e).slice(0, 120)}`);
    return [];
  }
  return recovered;
}

export function parseProtoPropertyIds(protoContent: string): Record<string, { decimalId: number | null; hexId: string | null }> {
  const propIdMap: Record<string, { decimalId: number | null; hexId: string | null }> = {};
  const enumStart = protoContent.indexOf("enum Property_ID {");
  if (enumStart === -1) return propIdMap;

  let braceDepth = 0;
  let enumEnd = -1;
  for (let index = enumStart; index < protoContent.length; index += 1) {
    const char = protoContent[index];
    if (char === "{") braceDepth += 1;
    if (char === "}") {
      braceDepth -= 1;
      if (braceDepth === 0) {
        enumEnd = index + 1;
        break;
      }
    }
  }
  if (enumEnd === -1) return propIdMap;

  const enumContent = protoContent.slice(enumStart, enumEnd);
  const pattern = /(\w+)\s*=\s*(\d+);\s*\/\/\s*([^|]+)/g;
  for (const match of enumContent.matchAll(pattern)) {
    const [, propName, decimalText, comment] = match;
    const hexMatch = comment.toUpperCase().match(/(0X[0-9A-F]+)/);
    propIdMap[propName] = {
      decimalId: Number(decimalText),
      hexId: hexMatch?.[1] ?? null,
    };
  }
  return propIdMap;
}

export function buildSignalsIdRecords(
  matches: SignalConfigMatch[],
  protoMap: Record<string, { decimalId: number | null; hexId: string | null }>,
): SignalIdRecord[] {
  const recordMap = new Map<string, SignalIdRecord>();
  for (const match of matches) {
    if (!recordMap.has(match.prop)) {
      const protoEntry = protoMap[match.prop];
      recordMap.set(match.prop, {
        prop: match.prop,
        decimalId: protoEntry?.decimalId ?? null,
        hexId: protoEntry?.hexId ?? null,
        access: match.access,
        sourceTokens: [],
        matchedSignals: [],
      });
    }
    const record = recordMap.get(match.prop)!;
    if (!record.sourceTokens.includes(match.sourceToken)) {
      record.sourceTokens.push(match.sourceToken);
    }
    if (match.matchedSignal && !record.matchedSignals.includes(match.matchedSignal)) {
      record.matchedSignals.push(match.matchedSignal);
    }
  }
  return Array.from(recordMap.values());
}

export function pickPlotSignal(match: SignalConfigMatch): string | null {
  if (match.matchedSignal) return match.matchedSignal;
  return collectSignalsFromConfigItem(match.configItem)[0] ?? null;
}

export function collectPlotSignals(matches: SignalConfigMatch[]): string[] {
  const signals = new Set<string>();

  for (const match of matches) {
    const signal = pickPlotSignal(match);
    if (!signal) continue;
    signals.add(signal);
  }

  return [...signals];
}
