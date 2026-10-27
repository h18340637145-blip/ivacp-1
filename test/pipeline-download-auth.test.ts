import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => ({ ...await importOriginal<typeof import("node:child_process")>(), spawn }));
import { buildBasicAuth, downloadWithNativeCurl, downloadWithPowerShell, downloadWithWinCurl } from "@/server/pipeline/download";
const scripts: string[] = [];
const configs: string[] = [];
beforeEach(() => {
 scripts.splice(0); configs.splice(0);
 vi.stubEnv("JIRA_SERVER", "https://jira.example.test"); vi.stubEnv("JIRA_USERNAME", "jira-user"); vi.stubEnv("JIRA_PASSWORD", "test-password");
 vi.stubEnv("BOSCH_JIRA_URL", "https://bosch.example.test"); vi.stubEnv("BOSCH_JIRA_USERNAME", "bosch-user"); vi.stubEnv("BOSCH_JIRA_API_TOKEN", "test-bosch-token"); vi.stubEnv("bosch_jira_api_token", "test-bosch-token");
 vi.spyOn(fs, "writeFile").mockImplementation(async (_file, data) => { configs.push(String(data)); });
 vi.spyOn(fs, "rename").mockResolvedValue(); vi.spyOn(fs, "rm").mockResolvedValue();
 spawn.mockImplementation((command: string, args: string[]) => {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn() });
  if (command === "powershell.exe") scripts.push(args.join(" "));
  queueMicrotask(() => { child.stdout.emit("data", Buffer.from(command === "wslpath" ? args[1] : "C:\\Temp")); child.emit("exit", 0); child.emit("close", 0); });
  return child;
 });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe("download credential boundary", () => {
 it("does not select Jira credentials for a non-Jira URL", () => {
  expect(buildBasicAuth("https://files.feishu.test/file")).toBe("");
 });
 it("selects Bosch credentials only for the configured Bosch Jira host", () => {
  expect(buildBasicAuth("https://bosch.example.test/file")).toBe(Buffer.from("bosch-user:test-bosch-token").toString("base64"));
 });
 it.each([["PowerShell", downloadWithPowerShell], ["WinCurl", downloadWithWinCurl], ["NativeCurl", downloadWithNativeCurl]] as const)("omits Authorization for non-Jira hosts in %s", async (_name, download) => {
  await download("https://files.feishu.test/file", "/tmp/test-download.png");
  expect([...scripts, ...configs].join("\n")).not.toContain("Authorization");
  expect([...scripts, ...configs].join("\n")).not.toContain(Buffer.from("jira-user:test-password").toString("base64"));
 });
 it.each([["PowerShell", downloadWithPowerShell], ["WinCurl", downloadWithWinCurl], ["NativeCurl", downloadWithNativeCurl]] as const)("keeps the matching Jira provider credential in %s", async (_name, download) => {
  await download("https://jira.example.test/file", "/tmp/test-download.png");
  expect([...scripts, ...configs].join("\n")).toContain(`Authorization`);
  expect([...scripts, ...configs].join("\n")).toContain(Buffer.from("jira-user:test-password").toString("base64"));
 });
});
