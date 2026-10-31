import { spawn } from "node:child_process";

/** The npm CLI starts a native child; a timeout must terminate the entire process group. */
export function executeMeegle(args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("meegle", args, { detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", finished = false;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const stop = (signal: NodeJS.Signals) => {
      if (process.platform !== "win32" && child.pid) {
        try { process.kill(-child.pid, signal); return; } catch { /* Already gone or unavailable; try the wrapper itself. */ }
      }
      child.kill(signal);
    };
    const fail = (code: string, message: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      stop("SIGTERM");
      escalation = setTimeout(() => stop("SIGKILL"), 250);
      escalation.unref();
      reject(Object.assign(new Error(message), { code, stderr }));
    };
    const deadline = setTimeout(() => fail("MEEGLE_CLI_TIMEOUT", "飞书 CLI 请求超时"), timeout);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (finished) return;
      stdout += chunk;
      if (Buffer.byteLength(stdout) > 10 * 1024 * 1024) fail("MEEGLE_CLI_OUTPUT_LIMIT", "飞书 CLI 响应超过大小限制");
    });
    child.stderr.on("data", (chunk: string) => { if (!finished) stderr = (stderr + chunk).slice(-64 * 1024); });
    child.once("error", error => {
      if (finished) return;
      finished = true; clearTimeout(deadline);
      reject(Object.assign(error, { stderr }));
    });
    child.once("close", (code, signal) => {
      clearTimeout(deadline);
      // Keep escalation after timeout: the native child may ignore TERM after the wrapper exits.
      if (!finished) {
        finished = true;
        if (escalation) clearTimeout(escalation);
        if (code === 0) resolve(stdout);
        else reject(Object.assign(new Error("飞书 CLI 执行失败"), { code, signal, stderr }));
      }
    });
  });
}
