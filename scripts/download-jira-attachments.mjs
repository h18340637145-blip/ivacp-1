#!/usr/bin/env node

import fs from "node:fs";
import fsp from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { HttpsProxyAgent } from "https-proxy-agent";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEFAULT_CONCURRENCY = 2;
const DOWNLOADERS = new Set(["auto", "node", "curl", "win-curl", "powershell"]);

loadEnvFile(path.join(PROJECT_ROOT, ".env"));
loadEnvFile(path.join(PROJECT_ROOT, ".env.local"));

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.target) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}

const issueKey = extractIssueKey(args.target);
if (!issueKey) {
  fail(`无法从输入中识别 Jira issue key: ${args.target}`);
}

const jiraServer = normalizeServer(args.server ?? process.env.JIRA_SERVER ?? args.target);
const outputDir = path.resolve(
  PROJECT_ROOT,
  args.out ?? path.join("jira-issues", "manual-downloads", issueKey)
);
const concurrency = Number.parseInt(args.concurrency ?? "", 10) || DEFAULT_CONCURRENCY;
const extensionFilter = parseExtensionFilter(args.ext);
const includeFilter = args.include ? String(args.include).toLowerCase() : "";
const downloader = normalizeDownloader(args.downloader);
const segments = Math.max(1, Number.parseInt(args.segments ?? "", 10) || 1);
const overwrite = Boolean(args.overwrite);
const dryRun = Boolean(args.dryRun);

await main();

async function main() {
  const authHeaders = buildAuthHeaders();
  const issueUrl = `${jiraServer}/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=attachment`;

  console.log(`[Jira] issue=${issueKey}`);
  console.log(`[Jira] server=${jiraServer}`);
  console.log(`[Jira] output=${outputDir}`);
  console.log(`[Jira] auth=${authHeaders.Authorization ? "basic" : authHeaders.Cookie ? "cookie" : "none"}`);
  console.log(`[Jira] proxy=${getProxyUrl() ?? "none"}`);
  console.log(`[Jira] downloader=${downloader}`);

  const issue = await requestJson(issueUrl, authHeaders);
  const attachments = assignOutputNames((issue.fields?.attachment ?? [])
    .map(normalizeAttachment)
    .filter((item) => !includeFilter || item.filename.toLowerCase().includes(includeFilter))
    .filter((item) => !extensionFilter || matchesExtensionFilter(item.filename, extensionFilter)));

  if (attachments.length === 0) {
    console.log(extensionFilter ? "[Jira] 未找到匹配扩展名的附件" : "[Jira] 该票无附件");
    return;
  }

  console.log(`[Jira] attachments=${attachments.length}`);
  for (const attachment of attachments) {
    const outputHint = attachment.outputName === sanitizeFileName(attachment.filename)
      ? ""
      : ` -> ${attachment.outputName}`;
    console.log(`- ${attachment.filename}${outputHint} (${formatBytes(attachment.size)}, ${attachment.created || "no-date"})`);
  }

  if (dryRun) {
    console.log("[Jira] dry-run: 仅列出附件，不下载");
    return;
  }

  await fsp.mkdir(outputDir, { recursive: true });
  await downloadAll(attachments, {
    authHeaders,
    concurrency: Math.max(1, concurrency),
    downloader,
    outputDir,
    segments,
    overwrite,
  });
}

async function downloadAll(attachments, options) {
  let nextIndex = 0;
  let failed = 0;

  async function worker() {
    while (nextIndex < attachments.length) {
      const attachment = attachments[nextIndex++];
      const safeName = attachment.outputName;
      const destPath = path.join(options.outputDir, safeName);

      try {
        if (!options.overwrite && fs.existsSync(destPath)) {
          console.log(`[skip] ${safeName} 已存在`);
          continue;
        }

        await downloadFileWithRetry(attachment, destPath, options);
        console.log(`[ok] ${safeName}`);
      } catch (error) {
        failed += 1;
        console.error(`[fail] ${safeName}: ${errorMessage(error)}`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(options.concurrency, attachments.length) }, () => worker());
  await Promise.all(workers);

  if (failed > 0) {
    fail(`${failed} 个附件下载失败`);
  }
}

function requestJson(url, authHeaders) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, makeRequestOptions(url, authHeaders), (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf-8");
        const statusCode = res.statusCode ?? 0;

        if (statusCode < 200 || statusCode >= 300) {
          reject(new Error(`HTTP ${statusCode}: ${text.slice(0, 500)}`));
          return;
        }

        try {
          resolve(JSON.parse(text));
        } catch (error) {
          reject(new Error(`Jira 返回不是 JSON: ${errorMessage(error)}`));
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(30_000, () => req.destroy(new Error("Jira issue 查询超时")));
  });
}

async function downloadFileWithRetry(attachment, destPath, options) {
  try {
    await downloadBySelectedMethod(attachment, destPath, options);
  } catch (error) {
    await fsp.rm(`${destPath}.download`, { force: true }).catch(() => {});
    console.warn(`[retry] ${path.basename(destPath)}: ${errorMessage(error)}`);
    await downloadBySelectedMethod(attachment, destPath, options);
  }
}

async function downloadBySelectedMethod(attachment, destPath, options) {
  const selected = resolveDownloader(options.downloader);

  if (selected === "powershell") {
    await downloadWithPowerShell(attachment.contentUrl, destPath, options.authHeaders);
    return;
  }

  if (selected === "curl") {
    await downloadWithCurl("curl", attachment, destPath, options.authHeaders, options.segments);
    return;
  }

  if (selected === "win-curl") {
    await downloadWithCurl("curl.exe", attachment, destPath, options.authHeaders, options.segments);
    return;
  }

  await downloadFile(attachment.contentUrl, destPath, options.authHeaders);
}

function resolveDownloader(selected) {
  if (selected !== "auto") return selected;
  // In WSL, PowerShell WebClient is fastest (uses Windows native HTTP + NTLM proxy)
  if (isWsl() && commandExists("powershell.exe")) return "powershell";
  if (commandExists("curl.exe")) return "win-curl";
  if (commandExists("curl")) return "curl";
  return "node";
}

let _isWsl = null;
function isWsl() {
  if (_isWsl !== null) return _isWsl;
  try {
    const version = fs.readFileSync("/proc/version", "utf-8");
    _isWsl = /microsoft|wsl/i.test(version);
  } catch {
    _isWsl = false;
  }
  return _isWsl;
}

/**
 * Download using PowerShell .NET WebClient.
 * Uses Windows native HTTP stack with system proxy + NTLM auto-negotiation.
 * ~30x faster than curl.exe via cntlm proxy in WSL environments.
 */
async function downloadWithPowerShell(url, destPath, authHeaders) {
  const winTempDir = await runCommandCapture("powershell.exe", [
    "-NoProfile", "-Command", "[Console]::Out.Write($env:TEMP)",
  ]);
  const safeName = sanitizeFileName(path.basename(destPath));
  const winTmpPath = `${winTempDir.replace(/[\\/]$/, "")}\\jira-dl-${process.pid}-${safeName}`;
  const winFinalPath = await toWindowsPath(destPath);

  // Build auth header for PowerShell
  let authHeader = "";
  if (authHeaders.Authorization) {
    authHeader = authHeaders.Authorization;
  } else if (authHeaders.Cookie) {
    // Cookie auth: pass as header
    authHeader = "";
  }

  const psUrl = url.replace(/'/g, "''");
  const psScript = [
    "[System.Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}",
    "$wc = New-Object System.Net.WebClient",
    "$wc.Proxy = [System.Net.WebRequest]::DefaultWebProxy",
    "$wc.Proxy.Credentials = [System.Net.CredentialCache]::DefaultNetworkCredentials",
  ];

  if (authHeader) {
    psScript.push(`$wc.Headers.Add('Authorization', '${authHeader.replace(/'/g, "''")}')`);
  }
  if (authHeaders.Cookie) {
    psScript.push(`$wc.Headers.Add('Cookie', '${authHeaders.Cookie.replace(/'/g, "''")}')`);
  }
  psScript.push(`$wc.Headers.Add('Accept', 'application/octet-stream, */*')`);
  psScript.push(`$wc.DownloadFile('${psUrl}', '${winTmpPath.replace(/'/g, "''")}')`);
  psScript.push(`Move-Item -LiteralPath '${winTmpPath.replace(/'/g, "''")}' -Destination '${winFinalPath.replace(/'/g, "''")}' -Force`);
  psScript.push(`Write-Output "OK"`);

  await runCommand("powershell.exe", ["-NoProfile", "-Command", psScript.join("\n")]);
}

async function downloadWithCurl(command, attachment, destPath, authHeaders, segments = 1) {
  if (segments > 1 && attachment.size > 0) {
    await downloadWithCurlSegments(command, attachment, destPath, authHeaders, segments);
    return;
  }

  const isWindowsCurl = command === "curl.exe";
  const tmpPath = `${destPath}.download`;
  const useWindowsStaging = isWindowsCurl && process.env.JIRA_WIN_CURL_STAGE !== "0";
  const windowsFinalPath = isWindowsCurl ? await toWindowsPath(destPath) : "";
  const windowsStagingPath = useWindowsStaging
    ? await windowsTempPath(`${sanitizeFileName(path.basename(destPath))}.download`)
    : "";
  const outputPath = isWindowsCurl
    ? (useWindowsStaging ? windowsStagingPath : await toWindowsPath(tmpPath))
    : tmpPath;
  const configPath = path.join(
    path.dirname(destPath),
    `.curl-${process.pid}-${attachment.id || Date.now()}.conf`
  );
  const configForCurl = isWindowsCurl ? await toWindowsPath(configPath) : configPath;

  await writeCurlConfig(configPath, {
    authHeaders,
    outputPath,
    proxyUrl: proxyForDownloader(command),
    url: attachment.contentUrl,
  });

  try {
    await runCommand(command, curlArgs(configForCurl, { continueAt: true }));
    if (useWindowsStaging) {
      await moveWindowsFile(windowsStagingPath, windowsFinalPath);
    } else {
      await fsp.rename(tmpPath, destPath);
    }
  } finally {
    await fsp.rm(configPath, { force: true }).catch(() => {});
  }
}

async function downloadWithCurlSegments(command, attachment, destPath, authHeaders, segmentCount) {
  const isWindowsCurl = command === "curl.exe";
  const useWindowsStaging = isWindowsCurl && process.env.JIRA_WIN_CURL_STAGE !== "0";
  const configPaths = [];
  const partPaths = [];

  try {
    const ranges = buildRanges(attachment.size, segmentCount);

    for (let i = 0; i < ranges.length; i += 1) {
      const partName = `${sanitizeFileName(path.basename(destPath))}.part${String(i + 1).padStart(2, "0")}`;
      const partPath = useWindowsStaging
        ? await windowsTempPath(partName)
        : `${destPath}.part${String(i + 1).padStart(2, "0")}`;
      const wslPartPath = isWindowsCurl ? await toWslPath(partPath) : partPath;
      const configPath = path.join(path.dirname(destPath), `.curl-${process.pid}-${attachment.id || Date.now()}-${i}.conf`);
      const configForCurl = isWindowsCurl ? await toWindowsPath(configPath) : configPath;

      await writeCurlConfig(configPath, {
        authHeaders,
        outputPath: isWindowsCurl ? partPath : wslPartPath,
        proxyUrl: proxyForDownloader(command),
        url: attachment.contentUrl,
      });

      configPaths.push(configPath);
      partPaths.push(wslPartPath);
      ranges[i].configForCurl = configForCurl;
      ranges[i].partPath = wslPartPath;
    }

    await Promise.all(ranges.map(async (range, index) => {
      await runCommand(command, [
        ...curlArgs(range.configForCurl, { continueAt: false }),
        "--range",
        `${range.start}-${range.end}`,
      ]);
      console.log(`[part] ${attachment.outputName} ${index + 1}/${ranges.length}`);
    }));

    await concatFiles(partPaths, destPath);
  } finally {
    await Promise.all([
      ...configPaths.map((file) => fsp.rm(file, { force: true }).catch(() => {})),
      ...partPaths.map((file) => fsp.rm(file, { force: true }).catch(() => {})),
    ]);
  }
}

function curlArgs(configPath, options) {
  const args = [
    "--config", configPath,
    "--location",
    "--fail",
    "--silent",
    "--show-error",
    "--retry", "5",
    "--retry-delay", "2",
    "--retry-all-errors",
    "--connect-timeout", "30",
    "--max-time", "0",
    "--speed-limit", "1024",
    "--speed-time", "120",
    "--insecure",
  ];

  if (options.continueAt) {
    args.push("--continue-at", "-");
  }

  return args;
}

function buildRanges(size, segmentCount) {
  const count = Math.min(segmentCount, size);
  const chunkSize = Math.ceil(size / count);
  const ranges = [];

  for (let i = 0; i < count; i += 1) {
    const start = i * chunkSize;
    const end = Math.min(size - 1, start + chunkSize - 1);
    ranges.push({ start, end });
  }

  return ranges;
}

async function concatFiles(partPaths, destPath) {
  const tmpPath = `${destPath}.download`;
  await fsp.rm(tmpPath, { force: true }).catch(() => {});

  const output = fs.createWriteStream(tmpPath);
  try {
    for (const partPath of partPaths) {
      const input = fs.createReadStream(partPath);
      for await (const chunk of input) {
        if (!output.write(chunk)) {
          await once(output, "drain");
        }
      }
    }
    output.end();
    await once(output, "finish");
    await fsp.rename(tmpPath, destPath);
  } catch (error) {
    output.destroy();
    await fsp.rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  } finally {
    output.removeAllListeners();
  }
}

async function writeCurlConfig(configPath, options) {
  const lines = [
    `url = "${escapeCurlConfig(options.url)}"`,
    `output = "${escapeCurlConfig(options.outputPath)}"`,
    `user-agent = "jira-attachment-downloader/1.0"`,
    `header = "Accept: application/octet-stream, */*"`,
  ];

  if (options.proxyUrl) {
    lines.push(`proxy = "${escapeCurlConfig(options.proxyUrl)}"`);
  }

  if (options.authHeaders.Authorization) {
    lines.push(`header = "Authorization: ${escapeCurlConfig(options.authHeaders.Authorization)}"`);
  }
  if (options.authHeaders.Cookie) {
    lines.push(`header = "Cookie: ${escapeCurlConfig(options.authHeaders.Cookie)}"`);
  }

  await fsp.writeFile(configPath, `${lines.join("\n")}\n`, { mode: 0o600 });
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "inherit", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exit ${code}: ${stderr.trim().slice(0, 300)}`));
    });
  });
}

async function windowsTempPath(filename) {
  const tempDir = await runCommandCapture("powershell.exe", [
    "-NoProfile",
    "-Command",
    "[Console]::Out.Write($env:TEMP)",
  ]);
  const safe = filename.replace(/[<>:"/\\|?*]/g, "_");
  return `${tempDir.replace(/[\\/]$/, "")}\\jira-attachments-${process.pid}-${safe}`;
}

async function moveWindowsFile(fromPath, toPath) {
  await runCommand("powershell.exe", [
    "-NoProfile",
    "-Command",
    "& { param($src, $dst) Move-Item -LiteralPath $src -Destination $dst -Force }",
    fromPath,
    toPath,
  ]);
}

function runCommandCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${command} exit ${code}: ${stderr.trim().slice(0, 300)}`));
    });
  });
}

function downloadFile(url, destPath, authHeaders, depth = 0) {
  if (depth > 5) {
    return Promise.reject(new Error("重定向超过 5 次"));
  }

  return new Promise((resolve, reject) => {
    const tmpPath = `${destPath}.download`;
    const req = https.get(url, makeRequestOptions(url, authHeaders), (res) => {
      const statusCode = res.statusCode ?? 0;
      const location = res.headers.location;

      if (statusCode >= 300 && statusCode < 400) {
        res.resume();
        if (!location) {
          reject(new Error(`HTTP ${statusCode} 缺少 Location`));
          return;
        }
        const nextUrl = new URL(location, url).href;
        downloadFile(nextUrl, destPath, authHeadersForRedirect(url, nextUrl, authHeaders), depth + 1)
          .then(resolve, reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        res.resume();
        reject(new Error(`HTTP ${statusCode}`));
        return;
      }

      const stream = fs.createWriteStream(tmpPath);
      pipeline(res, stream).then(async () => {
        try {
          await fsp.rename(tmpPath, destPath);
          resolve();
        } catch (error) {
          reject(error);
        }
      }).catch(async (error) => {
        await fsp.rm(tmpPath, { force: true }).catch(() => {});
        reject(error);
      });
    });

    req.on("error", reject);
    req.setTimeout(600_000, () => req.destroy(new Error("附件下载超时")));
  });
}

function makeRequestOptions(url, authHeaders) {
  return {
    agent: makeAgent(),
    headers: {
      Accept: "application/json, application/octet-stream, */*",
      "User-Agent": "jira-attachment-downloader/1.0",
      ...authHeaders,
    },
    rejectUnauthorized: process.env.JIRA_REJECT_UNAUTHORIZED === "true",
  };
}

function makeAgent() {
  const proxyUrl = getProxyUrl();
  if (proxyUrl) {
    return new HttpsProxyAgent(proxyUrl);
  }
  return new https.Agent({ rejectUnauthorized: process.env.JIRA_REJECT_UNAUTHORIZED === "true" });
}

function buildAuthHeaders() {
  if (process.env.JIRA_COOKIE) {
    return { Cookie: process.env.JIRA_COOKIE };
  }

  const username = process.env.JIRA_USERNAME;
  const password = process.env.JIRA_PASSWORD;
  if (!username || !password) {
    return {};
  }

  return {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
}

function authHeadersForRedirect(fromUrl, toUrl, authHeaders) {
  const from = new URL(fromUrl);
  const to = new URL(toUrl);
  return from.hostname === to.hostname ? authHeaders : {};
}

function normalizeAttachment(raw) {
  return {
    id: String(raw.id ?? ""),
    filename: String(raw.filename ?? raw.id ?? "attachment"),
    created: String(raw.created ?? ""),
    size: Number(raw.size ?? 0),
    contentUrl: String(raw.content ?? ""),
  };
}

function assignOutputNames(attachments) {
  const seen = new Map();

  return attachments.map((attachment, index) => {
    const baseName = sanitizeFileName(attachment.filename || `attachment-${index + 1}`);
    const count = seen.get(baseName) ?? 0;
    seen.set(baseName, count + 1);

    if (count === 0) {
      return { ...attachment, outputName: baseName };
    }

    const ext = path.extname(baseName);
    const stem = ext ? baseName.slice(0, -ext.length) : baseName;
    const suffix = attachment.id || String(index + 1);
    return { ...attachment, outputName: `${stem}-${suffix}${ext}` };
  });
}

function parseArgs(argv) {
  const parsed = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--overwrite") parsed.overwrite = true;
    else if (arg === "--server") parsed.server = argv[++i];
    else if (arg === "--out") parsed.out = argv[++i];
    else if (arg === "--concurrency") parsed.concurrency = argv[++i];
    else if (arg === "--downloader") parsed.downloader = argv[++i];
    else if (arg === "--ext") parsed.ext = argv[++i];
    else if (arg === "--include") parsed.include = argv[++i];
    else if (arg === "--segments") parsed.segments = argv[++i];
    else if (!parsed.target) parsed.target = arg;
    else fail(`未知参数: ${arg}`);
  }

  return parsed;
}

function normalizeDownloader(value) {
  const selected = value || "auto";
  if (!DOWNLOADERS.has(selected)) {
    fail(`未知下载器: ${selected}，可选值: ${Array.from(DOWNLOADERS).join(", ")}`);
  }
  return selected;
}

function extractIssueKey(input) {
  const match = String(input).match(/[A-Z][A-Z0-9]+-\d+/);
  return match?.[0] ?? "";
}

function normalizeServer(input) {
  try {
    const url = new URL(input);
    return url.origin;
  } catch {
    return String(input).replace(/\/$/, "");
  }
}

function parseExtensionFilter(value) {
  if (!value) return null;
  return (
    value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
      .map((item) => (item.startsWith(".") ? item : `.${item}`))
  );
}

function matchesExtensionFilter(filename, extensions) {
  const lowerName = filename.toLowerCase();
  return extensions.some((ext) => lowerName.endsWith(ext));
}

function sanitizeFileName(value) {
  return value.replace(/[/\\:*?"<>|]/g, "_").slice(0, 180);
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return "unknown size";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function getProxyUrl() {
  return process.env.https_proxy
    || process.env.HTTPS_PROXY
    || process.env.http_proxy
    || process.env.HTTP_PROXY;
}

function proxyForDownloader(command) {
  const override = process.env.JIRA_DOWNLOAD_PROXY;
  if (override && override.toLowerCase() === "none") return "";

  const proxyUrl = override || getProxyUrl();
  if (!proxyUrl) return "";

  if (command === "curl.exe") {
    return proxyUrl.replace("://wsl-proxy:", "://127.0.0.1:");
  }

  return proxyUrl;
}

function commandExists(command) {
  const pathEnv = process.env.PATH || "";
  const names = process.platform === "win32" || command.endsWith(".exe")
    ? [command]
    : [command];

  for (const dir of pathEnv.split(path.delimiter)) {
    for (const name of names) {
      if (fs.existsSync(path.join(dir, name))) return true;
    }
  }
  return false;
}

function toWindowsPath(value) {
  return new Promise((resolve, reject) => {
    const child = spawn("wslpath", ["-w", value], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`wslpath exit ${code}: ${stderr.trim()}`));
    });
  });
}

function toWslPath(value) {
  return new Promise((resolve, reject) => {
    const child = spawn("wslpath", ["-u", value], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`wslpath exit ${code}: ${stderr.trim()}`));
    });
  });
}

function escapeCurlConfig(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    process.env[key] = rawValue
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
  }
}

function printHelp() {
  console.log(`
Usage:
  node scripts/download-jira-attachments.mjs <jira-browse-url-or-issue-key> [options]

Options:
  --dry-run              只查询并列出附件，不下载
  --overwrite            覆盖已存在文件
  --out <dir>            输出目录，默认 jira-issues/manual-downloads/<issueKey>
  --server <url>         Jira server，默认读取 JIRA_SERVER 或从 URL 提取 origin
  --concurrency <n>      并发下载数，默认 ${DEFAULT_CONCURRENCY}
  --downloader <name>    下载后端：auto、win-curl、curl、node，默认 auto
  --ext <list>           只下载指定扩展名，例如 .zip,.asc,.blf
  --include <text>       只下载文件名包含指定文本的附件
  --segments <n>         单个大文件分片并发下载数，默认 1

Auth:
  优先使用 JIRA_COOKIE；否则使用 JIRA_USERNAME + JIRA_PASSWORD。
  脚本会自动读取项目根目录 .env / .env.local。
  如需下载阶段禁用代理，可临时设置 JIRA_DOWNLOAD_PROXY=none。
  如需下载阶段使用特定代理，可设置 JIRA_DOWNLOAD_PROXY=http://host:port。

Tips:
  在 WSL 里下载大附件慢时，优先试 --downloader win-curl。
  大分卷推荐：JIRA_DOWNLOAD_PROXY=none npm run jira:attachments -- <url> --downloader win-curl --segments 6 --concurrency 1。
  只下载 CAN/日志压缩包可用 --ext .blf,.zip.001,.zip.002。
`);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function fail(message) {
  console.error(`[error] ${message}`);
  process.exit(1);
}
