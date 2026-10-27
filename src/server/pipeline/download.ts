import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import https from "node:https";
import type { JiraAttachment } from "@/server/jira/types";
import { getJiraConnection, getJiraConnectionForUrl } from "@/server/jira/connection";
import { getProxyUrl, makeAgent } from "@/server/jira/http";
import { runMeegle } from "@/server/meegle/cli";
import { buildMeegleCommentAttachmentDownloadArgs } from "@/server/meegle/comment-attachments";

export function buildBasicAuth(url?: string): string {
  const connection = url ? getJiraConnectionForUrl(url) : null;
  return (connection ?? getJiraConnection("default")).basicAuth;
}

export { getProxyUrl, makeAgent };

export function isJiraHost(hostname: string): boolean {
  return getJiraConnectionForUrl(`https://${hostname}/`) !== null;
}

/**
 * Download a URL to a local file using node:https, following redirects.
 * Only sends Basic Auth to the original host (same-origin redirects).
 */
export function downloadFollow(
  url: string,
  destPath: string,
  auth: string,
  originalHost: string,
  depth: number
): Promise<void> {
  if (depth > 5) return Promise.reject(new Error("重定向次数超过限制（>5）"));

  return new Promise((resolve, reject) => {
    const proxyUrl = getProxyUrl();
    const agent = makeAgent(proxyUrl);
    const parsedUrl = new URL(url);
    const isSameHost = parsedUrl.hostname === originalHost;

    const headers: Record<string, string> = { Accept: "application/octet-stream" };
    if (isSameHost && isJiraHost(parsedUrl.hostname)) {
      headers.Authorization = `Basic ${auth}`;
    }

    const req = https.get(url, { agent, headers, rejectUnauthorized: false }, (res) => {
      const statusCode = res.statusCode ?? 0;
      const location = res.headers.location;

      // Follow redirects, but drop auth if crossing to a different host
      if (statusCode >= 300 && statusCode < 400) {
        res.resume(); // drain response body
        if (!location) {
          reject(new Error(`重定向 ${statusCode} 无 Location 头: ${url}`));
          return;
        }
        const nextUrl = new URL(location, url).href;
        downloadFollow(nextUrl, destPath, auth, originalHost, depth + 1).then(resolve, reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        res.resume();
        reject(new Error(`HTTP ${statusCode} 下载失败: ${url}`));
        return;
      }

      // Stream 2xx response directly to file (no full buffer in memory)
      const ws = createWriteStream(destPath);
      res.pipe(ws);
      ws.on("finish", resolve);
      ws.on("error", (err) => { ws.destroy(); reject(err); });
      res.on("error", (err) => { ws.destroy(); reject(err); });
    });

    req.on("error", reject);
    req.setTimeout(600_000, () => req.destroy(new Error("下载超时（600s）")));
  });
}

export async function downloadWithHttp(url: string, destPath: string): Promise<void> {
  await downloadFollow(url, destPath, buildBasicAuth(url), new URL(url).hostname, 0);
}

/* ─── OS detection for download strategy ─────────────────────────────────── */

export type RuntimeEnv = "windows" | "wsl" | "linux";

let _detectedEnv: RuntimeEnv | null = null;

export async function detectRuntimeEnv(): Promise<RuntimeEnv> {
  if (_detectedEnv) return _detectedEnv;

  // Native Windows
  if (process.platform === "win32") {
    _detectedEnv = "windows";
    return _detectedEnv;
  }

  // WSL detection: check /proc/version for Microsoft/WSL
  try {
    const procVersion = await fs.readFile("/proc/version", "utf-8");
    if (/microsoft|wsl/i.test(procVersion)) {
      _detectedEnv = "wsl";
      return _detectedEnv;
    }
  } catch { /* not Linux or no /proc */ }

  _detectedEnv = "linux";
  return _detectedEnv;
}

/** Run a command and return stdout */
export function runCommandCapture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => { stdout += c.toString(); });
    child.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${command} exit ${code}: ${stderr.trim().slice(0, 300)}`));
    });
  });
}

/** Run a command and wait for it to finish */
export function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "inherit", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exit ${code}: ${stderr.trim().slice(0, 300)}`));
    });
  });
}

/** Convert WSL path to Windows path */
export async function toWindowsPath(wslPath: string): Promise<string> {
  return runCommandCapture("wslpath", ["-w", wslPath]);
}

/** Get a Windows temp file path from WSL */
export async function windowsTempPath(filename: string): Promise<string> {
  const tempDir = await runCommandCapture("powershell.exe", [
    "-NoProfile", "-Command", "[Console]::Out.Write($env:TEMP)",
  ]);
  const safe = filename.replace(/[<>:"/\\|?*]/g, "_");
  return `${tempDir.replace(/[\\/]$/, "")}\\jira-dl-${process.pid}-${safe}`;
}

/** Move a file from Windows path to Windows path using PowerShell */
export async function moveWindowsFile(fromPath: string, toPath: string): Promise<void> {
  await runCommand("powershell.exe", [
    "-NoProfile", "-Command",
    "& { param($src, $dst) Move-Item -LiteralPath $src -Destination $dst -Force }",
    fromPath, toPath,
  ]);
}

export function escapeCurlConfig(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Get proxy URL adjusted for Windows curl (wsl-proxy → 127.0.0.1) */
export function proxyForCurl(isWindowsCurl: boolean): string {
  const override = process.env.JIRA_DOWNLOAD_PROXY;
  if (override && override.toLowerCase() === "none") return "";
  const proxyUrl = override || getProxyUrl();
  if (!proxyUrl) return "";
  if (isWindowsCurl) return proxyUrl.replace("://wsl-proxy:", "://127.0.0.1:");
  return proxyUrl;
}

/**
 * Download using PowerShell .NET WebClient from WSL.
 * Uses Windows native HTTP stack with system proxy + NTLM auto-negotiation.
 * ~30x faster than curl.exe via cntlm proxy in WSL environments.
 */
export async function downloadWithPowerShell(url: string, destPath: string): Promise<void> {
  const auth = buildBasicAuth(url);
  const filename = path.basename(destPath);
  const safe = filename.replace(/[<>:"/\\|?*]/g, "_");

  // Stage to Windows temp, then copy to WSL path
  const winDownloadDir = await runCommandCapture("powershell.exe", [
    "-NoProfile", "-Command", "[Console]::Out.Write($env:TEMP)",
  ]);
  const winTmpPath = `${winDownloadDir.replace(/[\\/]$/, "")}\\jira-dl-${process.pid}-${safe}`;
  const winFinalPath = await toWindowsPath(destPath);

  // Escape single quotes in URL for PowerShell
  const psUrl = url.replace(/'/g, "''");
  const psScript = `
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = {$true}
$wc = New-Object System.Net.WebClient
$wc.Proxy = [System.Net.WebRequest]::DefaultWebProxy
$wc.Proxy.Credentials = [System.Net.CredentialCache]::DefaultNetworkCredentials
$wc.Headers.Add('Authorization', 'Basic ${auth}')
$wc.Headers.Add('Accept', 'application/octet-stream, */*')
$wc.DownloadFile('${psUrl}', '${winTmpPath.replace(/'/g, "''")}')
Move-Item -LiteralPath '${winTmpPath.replace(/'/g, "''")}' -Destination '${winFinalPath.replace(/'/g, "''")}' -Force
Write-Output "OK"
`.trim();

  await runCommand("powershell.exe", ["-NoProfile", "-Command", psScript]);
}

/**
 * Download using curl.exe from WSL (win-curl method).
 * Stages file to Windows %TEMP% then moves to final WSL path.
 * Fallback when PowerShell method fails.
 */
export async function downloadWithWinCurl(url: string, destPath: string): Promise<void> {
  const auth = buildBasicAuth(url);
  const filename = path.basename(destPath);
  const useStaging = process.env.JIRA_WIN_CURL_STAGE !== "0";

  const windowsFinalPath = await toWindowsPath(destPath);
  const stagingPath = useStaging
    ? await windowsTempPath(`${filename}.download`)
    : windowsFinalPath;

  // Write curl config
  const configPath = path.join(path.dirname(destPath), `.curl-${process.pid}-${Date.now()}.conf`);
  const configForCurl = await toWindowsPath(configPath);

  const lines = [
    `url = "${escapeCurlConfig(url)}"`,
    `output = "${escapeCurlConfig(stagingPath)}"`,
    `user-agent = "jira-attachment-downloader/1.0"`,
    `header = "Accept: application/octet-stream, */*"`,
    `header = "Authorization: Basic ${escapeCurlConfig(auth)}"`,
  ];
  const proxy = proxyForCurl(true);
  if (proxy) lines.push(`proxy = "${escapeCurlConfig(proxy)}"`);

  await fs.writeFile(configPath, lines.join("\n") + "\n", { mode: 0o600 });

  try {
    await runCommand("curl.exe", [
      "--config", configForCurl,
      "--location", "--fail", "--silent", "--show-error",
      "--retry", "5", "--retry-delay", "2", "--retry-all-errors",
      "--connect-timeout", "30", "--max-time", "0",
      "--speed-limit", "1024", "--speed-time", "120",
      "--insecure", "--continue-at", "-",
    ]);

    if (useStaging) {
      await moveWindowsFile(stagingPath, windowsFinalPath);
    }
  } finally {
    await fs.rm(configPath, { force: true }).catch(() => {});
  }
}

/**
 * Download using native curl on Windows (process.platform === 'win32').
 */
export async function downloadWithNativeCurl(url: string, destPath: string): Promise<void> {
  const auth = buildBasicAuth(url);
  const configPath = path.join(path.dirname(destPath), `.curl-${process.pid}-${Date.now()}.conf`);
  const tmpPath = `${destPath}.download`;

  const lines = [
    `url = "${escapeCurlConfig(url)}"`,
    `output = "${escapeCurlConfig(tmpPath)}"`,
    `user-agent = "jira-attachment-downloader/1.0"`,
    `header = "Accept: application/octet-stream, */*"`,
    `header = "Authorization: Basic ${escapeCurlConfig(auth)}"`,
  ];
  const proxy = proxyForCurl(false);
  if (proxy) lines.push(`proxy = "${escapeCurlConfig(proxy)}"`);

  await fs.writeFile(configPath, lines.join("\n") + "\n", { mode: 0o600 });

  try {
    const curlCmd = process.platform === "win32" ? "curl.exe" : "curl";
    await runCommand(curlCmd, [
      "--config", configPath,
      "--location", "--fail", "--silent", "--show-error",
      "--retry", "5", "--retry-delay", "2", "--retry-all-errors",
      "--connect-timeout", "30", "--max-time", "0",
      "--speed-limit", "1024", "--speed-time", "120",
      "--insecure", "--continue-at", "-",
    ]);
    await fs.rename(tmpPath, destPath);
  } finally {
    await fs.rm(configPath, { force: true }).catch(() => {});
    await fs.rm(tmpPath, { force: true }).catch(() => {});
  }
}

/**
 * Helper: checks if a local file exists and matches the expected size.
 */
export async function fileExistsAndSizeMatches(filePath: string, expectedSize: number): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.size === expectedSize;
  } catch {
    return false;
  }
}

/**
 * Download a Jira attachment with OS-aware strategy:
 * - Windows native: curl.exe directly
 * - WSL: PowerShell WebClient (fastest, uses Windows native HTTP + NTLM),
 *         fallback to win-curl, then node:https
 * - Linux: node:https with redirect following
 */
export async function downloadToFile(url: string, destPath: string, expectedSize?: number): Promise<void> {
  if (expectedSize !== undefined && await fileExistsAndSizeMatches(destPath, expectedSize)) {
    console.log(`[Download] 文件已存在且大小匹配 (${expectedSize} 字节)，跳过下载: ${path.basename(destPath)}`);
    return;
  }

  const env = await detectRuntimeEnv();

  switch (env) {
    case "windows":
      console.log(`[Download] 使用 Windows curl.exe 下载`);
      await downloadWithNativeCurl(url, destPath);
      break;

    case "wsl":
      console.log(`[Download] 使用 PowerShell WebClient 下载（Windows 原生 HTTP 栈 + 系统代理 NTLM）`);
      try {
        await downloadWithPowerShell(url, destPath);
      } catch (err) {
        console.warn(`[Download] PowerShell 下载失败: ${String(err).slice(0, 120)}`);
        console.log(`[Download] 回退到 win-curl...`);
        try {
          await downloadWithWinCurl(url, destPath);
        } catch (err2) {
          console.warn(`[Download] win-curl 也失败: ${String(err2).slice(0, 120)}`);
          console.log(`[Download] 最终回退到 node:https...`);
          await downloadWithHttp(url, destPath);
        }
      }
      break;

    case "linux":
    default:
      console.log(`[Download] 使用 HTTP 直接下载`);
      await downloadWithHttp(url, destPath);
      break;
  }
}

export async function downloadAttachment(
  attachment: JiraAttachment,
  destPath: string,
  meegleIdentity?: { projectKey: string; workItemId: string },
  stagedCommentAttachmentPaths?: Map<string, string>,
): Promise<void> {
  if (attachment.source === "meegle-comment") {
    const stagedPath = stagedCommentAttachmentPaths?.get(attachment.contentUrl);
    if (stagedPath) {
      await fs.copyFile(stagedPath, destPath);
      return;
    }
    if (!meegleIdentity) throw new Error("飞书评论附件缺少工作项身份");
    await runMeegle(buildMeegleCommentAttachmentDownloadArgs(attachment, meegleIdentity, destPath));
    return;
  }
  await downloadToFile(attachment.contentUrl, destPath, attachment.size);
}

export function attachmentDestination(attachRoot: string, filename: string): string {
  const destination = path.resolve(attachRoot, path.basename(filename));
  const root = path.resolve(attachRoot);
  if (destination === root || !destination.startsWith(`${root}${path.sep}`)) {
    throw new Error("附件文件名无效");
  }
  return destination;
}
