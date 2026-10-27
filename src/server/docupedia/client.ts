import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import https from "node:https";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { HttpsProxyAgent } from "https-proxy-agent";
import { recordDocupediaUpload } from "./upload-stats";
const DEFAULT_BASE_URL = "https://inside-docupedia.bosch.com/confluence2";
const DEFAULT_SPACE_KEY = "BCSCVC";
const DEFAULT_PARENT_ID = "1359712499"; // docupedia的父节点

type DocupediaAuth =
  | { mode: "cookie"; headerName: "Cookie"; headerValue: string }
  | { mode: "bearer"; headerName: "Authorization"; headerValue: string }
  | { mode: "basic"; headerName: "Authorization"; headerValue: string }
  | { mode: "negotiate" };

export interface DocupediaArchiveInput {
  issueKey: string;
  summary: string;
  ruleGroupName: string;
  carModel: string;
  logRoot: string;
  onProgress?: (event: DocupediaArchiveProgressEvent) => void | Promise<void>;
}

export interface DocupediaArchiveProgressEvent {
  kind: "archive_started" | "page_completed" | "page_failed";
  pageTotal: number;
  pageIndex?: number;
  title?: string;
  action?: "created" | "existing";
  error?: string;
}

export interface DocupediaArchiveResult {
  enabled: boolean;
  rootPageId?: string | null;
  rootPageUrl?: string | null;
  created: number;
  existing: number;
  skipped: number;
  failed: number;
}

interface DocupediaOptions {
  baseUrl: string;
  spaceKey: string;
  parentId: string;
  auth: string;
  requestTimeoutMs: number;
  requestRetries: number;
  retryDelayMs: number;
  retryMaxDelayMs: number;
}

interface PlannedDirectory {
  absolutePath: string;
  relativePath: string;
  parentRelativePath: string | null;
  title: string;
}

interface PlannedPage {
  filePath: string;
  parentRelativePath: string;
  title: string;
  text: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function getDocupediaOptions(env = process.env): DocupediaOptions {
  return {
    baseUrl: env.DOCUPEDIA_BASE_URL || DEFAULT_BASE_URL,
    spaceKey: env.DOCUPEDIA_SPACE_KEY || DEFAULT_SPACE_KEY,
    parentId: env.DOCUPEDIA_PARENT_ID || DEFAULT_PARENT_ID,
    auth: env.DOCUPEDIA_AUTH || "auto",
    requestTimeoutMs: parsePositiveInt(env.DOCUPEDIA_REQUEST_TIMEOUT_MS, 180_000),
    requestRetries: parsePositiveInt(env.DOCUPEDIA_REQUEST_RETRIES, 6),
    retryDelayMs: parsePositiveInt(env.DOCUPEDIA_RETRY_DELAY_MS, 3_000),
    retryMaxDelayMs: parsePositiveInt(env.DOCUPEDIA_RETRY_MAX_DELAY_MS, 60_000),
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isDocupediaEnabled(env = process.env): boolean {
  const docupediaFlag = env.ENABLE_DOCUPEDIA?.trim().toLowerCase();
  if (docupediaFlag !== undefined) {
    if (docupediaFlag === "0") {
      return false;
    }
    return docupediaFlag === "1";
  }
  return !["0", "false", "no", "off"].includes(String(env.DOCUPEDIA_ENABLED ?? "true").toLowerCase());
}

export function resolveDocupediaAuth(options: { auth: string }, env = process.env): DocupediaAuth {
  const mode = options.auth || "auto";

  if ((mode === "auto" || mode === "cookie") && env.DOCUPEDIA_COOKIE) {
    return { mode: "cookie", headerName: "Cookie", headerValue: env.DOCUPEDIA_COOKIE };
  }

  if ((mode === "auto" || mode === "bearer") && env.DOCUPEDIA_TOKEN) {
    return { mode: "bearer", headerName: "Authorization", headerValue: `Bearer ${env.DOCUPEDIA_TOKEN}` };
  }

  if ((mode === "auto" || mode === "basic") && env.DOCUPEDIA_USERNAME && env.DOCUPEDIA_PASSWORD) {
    const encoded = Buffer.from(`${env.DOCUPEDIA_USERNAME}:${env.DOCUPEDIA_PASSWORD}`).toString("base64");
    return { mode: "basic", headerName: "Authorization", headerValue: `Basic ${encoded}` };
  }

  if ((mode === "auto" || mode === "bearer") && env.DAN_TEST) {
    return { mode: "bearer", headerName: "Authorization", headerValue: `Bearer ${env.DAN_TEST}` };
  }

  if (mode === "basic" && env.EMAIL && env.DAN_TEST) {
    const encoded = Buffer.from(`${env.EMAIL}:${env.DAN_TEST}`).toString("base64");
    return { mode: "basic", headerName: "Authorization", headerValue: `Basic ${encoded}` };
  }

  if (mode === "negotiate" || mode === "auto") {
    return { mode: "negotiate" };
  }

  throw new Error(`Docupedia auth mode "${mode}" is missing required environment variables.`);
}

function escapeStorageText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, "<br />\n");
}

function buildCreatePagePayload(args: { title: string; text: string; spaceKey: string; parentId: string }) {
  return {
    type: "page",
    title: args.title,
    space: { key: args.spaceKey },
    ancestors: [{ id: String(args.parentId) }],
    body: {
      storage: {
        value: `<p>${escapeStorageText(args.text)}</p>`,
        representation: "storage",
      },
    },
  };
}

function pageUrl(baseUrl: string, response: { id?: string; _links?: { webui?: string } }): string | null {
  if (response._links?.webui) {
    return `${normalizeBaseUrl(baseUrl)}${response._links.webui}`;
  }
  if (response.id) {
    return `${normalizeBaseUrl(baseUrl)}/pages/viewpage.action?pageId=${response.id}`;
  }
  return null;
}

function requestJsonWithCurlNegotiate(url: string, payload: unknown, method = "POST", timeoutMs = 180_000): unknown {
  const body = payload ? JSON.stringify(payload) : "";
  const args = [
    "--silent",
    "--show-error",
    "--fail-with-body",
    "--negotiate",
    "-u",
    ":",
    "-H",
    "Accept: application/json",
    "-H",
    "Content-Type: application/json",
    "-X",
    method,
  ];

  if (payload) {
    args.push("--data-binary", "@-");
  }
  args.push(url);

  const result = spawnSync("curl", args, {
    encoding: "utf8",
    input: payload ? body : undefined,
    maxBuffer: 20 * 1024 * 1024,
    timeout: timeoutMs,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`curl negotiate request failed with code ${result.status}: ${result.stderr || result.stdout}`);
  }
  return result.stdout ? JSON.parse(result.stdout) : {};
}

function sendJsonRequest(method: string, url: string, payload: unknown, authConfig: DocupediaAuth, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : "";
    const parsed = new URL(url);
    const headers: Record<string, string | number> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };

    if (payload) {
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    if ("headerName" in authConfig) {
      headers[authConfig.headerName] = authConfig.headerValue;
    }

    const proxyUrl = getHttpsProxyUrl();
    const req = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname}${parsed.search}`,
      method,
      headers,
      rejectUnauthorized: false,
      agent: proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data: unknown = text;
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          // Preserve raw response body for non-JSON errors.
        }

        if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
          const message = typeof data === "string" ? data : JSON.stringify(data);
          reject(new Error(`Docupedia API returned HTTP ${res.statusCode}: ${message}`));
          return;
        }
        resolve(data);
      });
    });

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Docupedia request timed out after ${timeoutMs}ms`)));
    if (payload) {
      req.write(body);
    }
    req.end();
  });
}

function getHttpsProxyUrl(env = process.env): string | undefined {
  return env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
}

function getJson(url: string, authConfig: DocupediaAuth, timeoutMs: number): Promise<unknown> {
  return sendJsonRequest("GET", url, null, authConfig, timeoutMs);
}

function postJson(url: string, payload: unknown, authConfig: DocupediaAuth, timeoutMs: number): Promise<unknown> {
  return sendJsonRequest("POST", url, payload, authConfig, timeoutMs);
}

function isTransientDocupediaError(error: unknown): boolean {
  const message = String(error).toLowerCase();
  const curlTransientStatus = /\berror:\s*(?:429|50[0-4])\b/.test(message);
  return [
    "socket hang up",
    "econnreset",
    "etimedout",
    "esockettimedout",
    "epipe",
    "timeout",
    "timed out",
    "http 429",
    "http 500",
    "http 502",
    "http 503",
    "http 504",
  ].some((needle) => message.includes(needle)) || curlTransientStatus;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isImportableTextFile(filePath: string): boolean {
  const sample = readFileSync(filePath).subarray(0, 4096);
  return !sample.includes(0);
}

function createDocupediaRootTitle(): string {
  const randomId = randomUUID().replace(/-/g, "").slice(0, 12);
  return `meegle_${randomId}`;
}

function sanitizeDocupediaTitlePart(value: string): string {
  return value
    .replace(/[\\/]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "article";
}

function buildStepArticleTitle(sourceName: string, stepIndex: number): string {
  const safeName = sanitizeDocupediaTitlePart(sourceName);
  if (/^step\d+_/i.test(safeName)) {
    return safeName;
  }
  return `step${stepIndex}_${safeName}`;
}

function buildPrefixedDocupediaArticleTitle(rootTitle: string, articleTitle: string): string {
  return `${rootTitle}_${sanitizeDocupediaTitlePart(articleTitle)}`;
}

function getStepGroupKey(sourceName: string): string | null {
  const match = sourceName.match(/^(step\d+)_/i);
  return match ? match[1].toLowerCase() : null;
}

function formatStepGroupFileContent(sourceName: string, text: string): string {
  return `## ${sourceName}\n\n${text.trimEnd()}\n`;
}

async function buildIssueLogImportPlan(rootPath: string): Promise<{
  directories: PlannedDirectory[];
  pages: PlannedPage[];
  skipped: number;
}> {
  const rootTitle = createDocupediaRootTitle();
  const directories: PlannedDirectory[] = [];
  const pages: PlannedPage[] = [];
  let skipped = 0;
  let stepIndex = 1;

  async function flushStepGroupPages(args: {
    parentRelativePath: string;
    groupedFiles: Map<string, string[]>;
    standaloneFiles: string[];
  }): Promise<void> {
    for (const [stepKey, filePaths] of [...args.groupedFiles.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const sections: string[] = [];
      for (const filePath of filePaths.sort((left, right) => left.localeCompare(right))) {
        const sourceTitle = path.basename(filePath);
        const text = await fs.readFile(filePath, "utf8");
        sections.push(formatStepGroupFileContent(sourceTitle, text));
      }
      pages.push({
        filePath: filePaths[0],
        parentRelativePath: args.parentRelativePath,
        title: buildPrefixedDocupediaArticleTitle(rootTitle, stepKey),
        text: sections.join("\n"),
      });
    }

    for (const filePath of args.standaloneFiles.sort((left, right) => left.localeCompare(right))) {
      const sourceTitle = path.basename(filePath);
      const articleTitle = buildStepArticleTitle(sourceTitle, stepIndex++);
      const text = await fs.readFile(filePath, "utf8");
      pages.push({
        filePath,
        parentRelativePath: args.parentRelativePath,
        title: buildPrefixedDocupediaArticleTitle(rootTitle, articleTitle),
        text,
      });
    }
  }

  async function addDirectory(dirPath: string, relativePath: string, title: string): Promise<void> {
    const parentRelativePath = relativePath.includes(path.sep) ? path.dirname(relativePath) : null;
    directories.push({ absolutePath: dirPath, relativePath, parentRelativePath, title });

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
      .map((entry) => path.join(dirPath, entry.name))
      .sort((left, right) => left.localeCompare(right));

    const groupedFiles = new Map<string, string[]>();
    const standaloneFiles: string[] = [];

    for (const filePath of files) {
      const sourceTitle = path.basename(filePath);
      if (sourceTitle === "input_comments.txt") {
        skipped += 1;
        continue;
      }
      if (!isImportableTextFile(filePath)) {
        skipped += 1;
        continue;
      }
      const stepKey = getStepGroupKey(sourceTitle);
      if (stepKey) {
        const group = groupedFiles.get(stepKey) || [];
        group.push(filePath);
        groupedFiles.set(stepKey, group);
        continue;
      }
      standaloneFiles.push(filePath);
    }

    await flushStepGroupPages({ parentRelativePath: relativePath, groupedFiles, standaloneFiles });
  }

  async function walk(dirPath: string, relativePath: string, title: string): Promise<void> {
    await addDirectory(dirPath, relativePath, title);
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const childDirs = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => path.join(dirPath, entry.name))
      .sort((left, right) => left.localeCompare(right));

    for (const childDir of childDirs) {
      const childName = path.basename(childDir);
      const childRelativePath = path.join(relativePath, childName);
      await walk(childDir, childRelativePath, buildStepArticleTitle(childName, stepIndex++));
    }
  }

  await walk(rootPath, rootTitle, rootTitle);
  return { directories, pages, skipped };
}

async function findPageByTitle(args: {
  baseUrl: string;
  spaceKey: string;
  parentId: string;
  title: string;
  authConfig: DocupediaAuth;
  requestTimeoutMs: number;
}): Promise<{ id: string; url: string | null } | null> {
  const params = new URLSearchParams({
    spaceKey: args.spaceKey,
    title: args.title,
    type: "page",
    status: "current",
    expand: "ancestors",
  });
  const url = `${normalizeBaseUrl(args.baseUrl)}/rest/api/content?${params.toString()}`;
  const data = args.authConfig.mode === "negotiate"
    ? requestJsonWithCurlNegotiate(url, null, "GET", args.requestTimeoutMs)
    : await getJson(url, args.authConfig, args.requestTimeoutMs);
  const results = Array.isArray((data as { results?: unknown[] }).results)
    ? (data as { results: Array<{ id: string; title: string; ancestors?: Array<{ id: string }>; _links?: { webui?: string } }> }).results
    : [];

  const exact = results.find((page) => {
    if (page.title !== args.title) {
      return false;
    }
    const parent = page.ancestors?.[page.ancestors.length - 1];
    return parent && String(parent.id) === String(args.parentId);
  });
  if (!exact) {
    return null;
  }
  return { id: exact.id, url: pageUrl(args.baseUrl, exact) };
}

export async function withDocupediaRetries<T>(args: {
  title: string;
  options: DocupediaOptions;
  operation: () => Promise<T>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= args.options.requestRetries; attempt += 1) {
    try {
      return await args.operation();
    } catch (error) {
      lastError = error;
      if (attempt >= args.options.requestRetries || !isTransientDocupediaError(error)) {
        break;
      }
      const baseDelayMs = Math.min(
        args.options.retryDelayMs * 2 ** attempt,
        args.options.retryMaxDelayMs,
      );
      const jitter = 0.8 + (args.random?.() ?? Math.random()) * 0.4;
      const retryDelayMs = Math.min(
        Math.round(baseDelayMs * jitter),
        args.options.retryMaxDelayMs,
      );
      await (args.sleep ?? delay)(retryDelayMs);
    }
  }
  throw new Error(`Docupedia page "${args.title}" failed after ${args.options.requestRetries + 1} attempt(s): ${String(lastError)}`);
}

async function findOrCreatePage(args: {
  title: string;
  text: string;
  parentId: string;
  endpoint: string;
  options: DocupediaOptions;
  authConfig: DocupediaAuth;
}): Promise<{ action: "created" | "existing"; id: string | null; url: string | null }> {
  return withDocupediaRetries({
    title: args.title,
    options: args.options,
    operation: async () => {
      const existing = await findPageByTitle({
        baseUrl: args.options.baseUrl,
        spaceKey: args.options.spaceKey,
        parentId: args.parentId,
        title: args.title,
        authConfig: args.authConfig,
        requestTimeoutMs: args.options.requestTimeoutMs,
      });
      if (existing) {
        return { action: "existing", id: existing.id, url: existing.url };
      }

      const payload = buildCreatePagePayload({
        title: args.title,
        text: args.text,
        spaceKey: args.options.spaceKey,
        parentId: args.parentId,
      });
      const response = args.authConfig.mode === "negotiate"
        ? requestJsonWithCurlNegotiate(args.endpoint, payload, "POST", args.options.requestTimeoutMs)
        : await postJson(args.endpoint, payload, args.authConfig, args.options.requestTimeoutMs);
      const created = response as { id?: string; _links?: { webui?: string } };
      return { action: "created", id: created.id || null, url: pageUrl(args.options.baseUrl, created) };
    },
  });
}

export async function archiveIssueLogToDocupedia(input: DocupediaArchiveInput): Promise<DocupediaArchiveResult> {
  if (!isDocupediaEnabled()) {
    return { enabled: false, created: 0, existing: 0, skipped: 0, failed: 0 };
  }

  const logRoot = path.resolve(input.logRoot);
  if (!existsSync(logRoot)) {
    throw new Error(`Current issue log directory does not exist: ${logRoot}`);
  }
  const relativeLogRoot = path.relative(process.cwd(), logRoot);
  if (relativeLogRoot.startsWith("..") || path.isAbsolute(relativeLogRoot) || !relativeLogRoot.split(path.sep).includes(input.issueKey)) {
    throw new Error(`Refusing to archive a path that is not the current issue logRoot: ${logRoot}`);
  }

  const options = getDocupediaOptions();
  const authConfig = resolveDocupediaAuth({ auth: options.auth });
  const endpoint = `${normalizeBaseUrl(options.baseUrl)}/rest/api/content`;
  const plan = await buildIssueLogImportPlan(logRoot);
  await input.onProgress?.({
    kind: "archive_started",
    pageTotal: plan.pages.length,
  });
  const pageIdsByRelativePath = new Map<string, string>();
  let created = 0;
  let existing = 0;
  let failed = 0;
  let rootPageId: string | null = null;
  let rootPageUrl: string | null = null;

  for (const directory of plan.directories) {
    const isRootDirectory = directory.parentRelativePath === null;
    const parentId = directory.parentRelativePath
      ? pageIdsByRelativePath.get(directory.parentRelativePath)
      : String(options.parentId);
    if (!parentId) {
      throw new Error(`Missing Docupedia parent page id for ${directory.relativePath}`);
    }
    const result = await findOrCreatePage({
      title: directory.title,
      text: isRootDirectory
        ? `Jira: ${input.issueKey}\nSummary: ${input.summary}\nRule group: ${input.ruleGroupName}\nCar model: ${input.carModel}\nLog root: ${relativeLogRoot}`
        : "",
      parentId,
      endpoint,
      options,
      authConfig,
    });
    if (result.action === "created") created += 1;
    if (result.action === "existing") existing += 1;
    if (result.id) {
      pageIdsByRelativePath.set(directory.relativePath, result.id);
    }
    if (isRootDirectory) {
      rootPageId = result.id;
      rootPageUrl = result.url;
    }
  }

  for (let pageIdx = 0; pageIdx < plan.pages.length; pageIdx += 1) {
    if (pageIdx > 0) {
      const uploadGapMs = (100 + Math.random() * 50) * 1000;
      await delay(uploadGapMs);
    }
    const page = plan.pages[pageIdx];
    const parentId = pageIdsByRelativePath.get(page.parentRelativePath);
    if (!parentId) {
      throw new Error(`Missing Docupedia parent page id for ${page.title}`);
    }
    try {
      const result = await findOrCreatePage({
        title: page.title,
        text: page.text,
        parentId,
        endpoint,
        options,
        authConfig,
      });
      if (result.action === "created") created += 1;
      if (result.action === "existing") existing += 1;
      try {
        const record = await recordDocupediaUpload({ title: page.title, text: page.text, action: result.action });
        if (record) {
          console.log(`[docupedia] ${record.month}: ${record.monthlyTotal} articles over 500 characters`);
        }
      } catch (error) {
        console.warn(`[docupedia] upload statistics write failed for "${page.title}": ${String(error).slice(0, 200)}`);
      }
      await input.onProgress?.({
        kind: "page_completed",
        pageIndex: pageIdx + 1,
        pageTotal: plan.pages.length,
        title: page.title,
        action: result.action,
      });
    } catch (error) {
      failed += 1;
      await input.onProgress?.({
        kind: "page_failed",
        pageIndex: pageIdx + 1,
        pageTotal: plan.pages.length,
        title: page.title,
        error: String(error).slice(0, 200),
      });
      console.warn(`[docupedia] skip failed page "${page.title}": ${String(error).slice(0, 200)}`);
    }
  }

  return {
    enabled: true,
    rootPageId,
    rootPageUrl,
    created,
    existing,
    skipped: plan.skipped,
    failed,
  };
}
