import https from "node:https";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, it } from "vitest";
const exec = promisify(execFile);
it("附件CLI保留帮助、筛选、同名文件、预览、跳过与覆盖下载（仅本地HTTPS）", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ivacp-download-"));
  const certFile = path.join(root, "cert.pem"), keyFile = path.join(root, "key.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyFile, "-out", certFile, "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
  let base = "", downloads = 0;
  const auth: string[] = [];
  const server = https.createServer({ key: await readFile(keyFile), cert: await readFile(certFile) }, (request, response) => {
    auth.push(request.headers.authorization ?? "");
    if (request.url?.startsWith("/rest/api/2/issue/TEST-1")) { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ fields: { attachment: [1, 2, 3].map(id => ({ id, filename: id < 3 ? "trace.zip" : "image.png", size: 7, content: `${base}/attachments/${id}` })) } })); }
    else if (request.url?.startsWith("/attachments/")) { downloads++; response.end("trace 1"); }
    else { response.statusCode = 404; response.end(); }
  });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); base = `https://127.0.0.1:${(server.address() as { port: number }).port}`;
    const script = path.join(process.cwd(), "scripts/download-jira-attachments.mjs");
    const env = { ...process.env, JIRA_COOKIE: "", JIRA_USERNAME: "test-user", JIRA_PASSWORD: "test-only", JIRA_REJECT_UNAUTHORIZED: "true", NODE_EXTRA_CA_CERTS: certFile, https_proxy: "", HTTPS_PROXY: "", http_proxy: "", HTTP_PROXY: "" };
    const run = (args: string[]) => exec(process.execPath, [script, ...args], { cwd: root, env });
    expect((await run(["--help"])).stdout).toContain("--downloader"); expect(auth).toHaveLength(0);
    const args = ["TEST-1", "--server", base, "--out", path.join(root, "out"), "--ext", ".zip", "--include", "trace", "--downloader", "node"];
    await run([...args, "--dry-run"]); expect(downloads).toBe(0);
    await run(args); expect(downloads).toBe(2); expect(await readFile(path.join(root, "out/trace.zip"), "utf8")).toBe("trace 1"); expect(await readFile(path.join(root, "out/trace-2.zip"), "utf8")).toBe("trace 1");
    await run(args); expect(downloads).toBe(2); await run([...args, "--overwrite"]); expect(downloads).toBe(4);
    expect(auth.every(value => value === `Basic ${Buffer.from("test-user:test-only").toString("base64")}`)).toBe(true);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
});
