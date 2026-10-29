import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { extractLogVersions, formatLogVersions } from "@/server/pipeline/log-versions";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
function dlt(text: string) {
  const value = Buffer.from(text + "\0");
  const packet = Buffer.alloc(16 + 4 + 10 + 6 + value.length);
  packet.write("DLT\x01"); packet.write("ECU1", 12);
  packet[16] = 0x21; packet.writeUInt16BE(packet.length - 16, 18);
  packet[20] = 0x41; packet[21] = 1; packet.write("APP1CTX1", 22);
  packet.writeUInt32LE(0x200, 30); packet.writeUInt16LE(value.length, 34); value.copy(packet, 36);
  return packet;
}
it("recursively pairs Buildinfo with only sibling Scc DLTs and preserves full values", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "versions-")); roots.push(root);
  const nested = path.join(root, "a", "b"); await fs.mkdir(nested, { recursive: true });
  await fs.writeFile(path.join(nested, "Buildinfo.txt"), "OTHER_MAIN_VERSION=no\nMAIN_VERSION= soc release 1 \n");
  await fs.writeFile(path.join(root, "Scc-wrong.dlt"), dlt("[Vip-App]App:wrong"));
  await fs.writeFile(path.join(nested, "Scc-1.dlt"), Buffer.concat([dlt("unrelated"), dlt("[Vip-App]App:scc release 2")]));
  const records = await extractLogVersions(root);
  expect(records).toEqual([{ buildInfo: "a/b/Buildinfo.txt", socVersion: "soc release 1", sccVersions: [{ file: "a/b/Scc-1.dlt", version: "scc release 2" }] }]);
  expect(formatLogVersions(records)).toContain("SOC版本：soc release 1");
  expect(formatLogVersions(records)).toContain("SCC版本：scc release 2");
});
it("retains SOC when SCC is absent or invalid and handles missing directories", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "versions-")); roots.push(root);
  await fs.writeFile(path.join(root, "Buildinfo.txt"), "MAIN_VERSION=soc\n");
  await fs.writeFile(path.join(root, "Scc-bad.dlt"), "invalid");
  expect(await extractLogVersions(root)).toEqual([{ buildInfo: "Buildinfo.txt", socVersion: "soc", sccVersions: [] }]);
  expect(await extractLogVersions(path.join(root, "missing"))).toEqual([]);
  expect(formatLogVersions([])).toBe("");
});
it("extracts versions from the supplied real DLT sample", async () => {
  const root = path.resolve("jira-issues/chery D01-8255/D01/meegle-7145952343/Je6W0a8V60RA4cUul9_ER/extracted");
  if (!await fs.stat(root).catch(() => null)) return;
  const records = await extractLogVersions(root);
  expect(records.find(r => r.buildInfo === "Buildinfo.txt")).toMatchObject({ socVersion: "rb-chery-idcpro_hqx4560-es11_ip9_release_2026.43.8", sccVersions: [{ file: "Scc-00000000-2026-10-28_10-03-39.dlt", version: "ES11_IP9_2026.43.8" }] });
});

it("persists versions at the end of extraction and model input without marking versions as signal evidence", async () => {
  const { collectEvidence } = await import("@/server/pipeline/process/evidence-stage");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "versions-stage-")); roots.push(root);
  const extracted = path.join(root, "extracted"); await fs.mkdir(extracted);
  await fs.writeFile(path.join(extracted, "Buildinfo.txt"), "MAIN_VERSION=soc-test");
  await fs.writeFile(path.join(extracted, "Scc-test.dlt"), dlt("[Vip-App]App:scc-test"));
  const metrics = { counts: {}, evidenceCompleteness: {} };
  const result = await collectEvidence({ logRoot: root, issueKey: "TEST-1", ruleGroupId: "g", groupDirName: "g", carModel: "D01", logger: { log() {} }, metrics } as unknown as Parameters<typeof collectEvidence>[0], {
    classified: { latestZip: { filename: "logs.zip" } } as Parameters<typeof collectEvidence>[1]["classified"],
    plotPromise: null, signals: { exactMatches: [], recoveredMatches: [], signalIdRecords: [], unmatchedTokens: [] } as unknown as Parameters<typeof collectEvidence>[1]["signals"],
    commentsText: "", extractDir: extracted, canTraceText: "", parsingStarted: null,
  });
  expect(result.extractMarkdown.trimEnd()).toMatch(/SCC版本：scc-test（来源：Scc-test.dlt）$/);
  expect(result.androidLog).toContain("SOC版本：soc-test");
  expect(await fs.readFile(path.join(root, "extract.md"), "utf8")).toBe(result.extractMarkdown);
  expect(await fs.readFile(path.join(root, "step4_android_qnx_input.md"), "utf8")).toContain("SCC版本：scc-test");
  expect(JSON.parse(await fs.readFile(path.join(root, "log-versions.json"), "utf8"))).toMatchObject({ schemaVersion: 1, records: [{ socVersion: "soc-test" }] });
  expect(metrics.evidenceCompleteness).toMatchObject({ androidQnxLogLinesFound: false });
});

it("preserves duplicate filenames in separate directories when extracting archives", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { extractArchive } = await import("@/server/pipeline/archive");
  const run = promisify(execFile);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "versions-archive-")); roots.push(root);
  const input = path.join(root, "input");
  for (const name of ["one", "two"]) {
    await fs.mkdir(path.join(input, name), { recursive: true });
    await fs.writeFile(path.join(input, name, "Buildinfo.txt"), `MAIN_VERSION=${name}`);
    await fs.writeFile(path.join(input, name, "Scc-test.dlt"), dlt(`[Vip-App]App:${name}`));
  }
  const archive = path.join(root, "logs.zip");
  await run("7za", ["a", archive, "."], { cwd: input });
  const output = path.join(root, "out"); await fs.mkdir(output);
  await extractArchive(archive, output);
  const records = await extractLogVersions(output);
  expect(records.map(r => [r.socVersion, r.sccVersions[0]?.version])).toEqual([["one", "one"], ["two", "two"]]);
});
