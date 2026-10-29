import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { extractVhalVersion, parseVhalVersion } from "@/server/pipeline/vhal-version";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
it("uses the reference encoding and ignores commented definitions", () => {
  expect(parseVhalVersion('/* #define VER_PRO_CFG "82550001" */\n// #define VER_PRO_CFG "82550002"\n # define VER_PRO_CFG "82552236" // current\r\n')).toEqual({ raw: "82552236", platform: "8255", version: "22.36" });
  for (const invalid of ['#define VER_PRO_CFG "8255223"', '#define OTHER_VER_PRO_CFG "82552236"', '#define VER_PRO_CFG 82552236']) expect(() => parseVhalVersion(invalid)).toThrow("VER_PRO_CFG");
});
it("reads type.h only from the configured Proto root and refreshes on each run", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vhal-")); roots.push(root);
  await fs.writeFile(path.join(root, "type.h"), '#define VER_PRO_CFG "82552236"');
  expect(await extractVhalVersion(root)).toMatchObject({ status: "ok", file: path.join(root, "type.h"), raw: "82552236", platform: "8255", version: "22.36" });
  await fs.writeFile(path.join(root, "type.h"), '#define VER_PRO_CFG "82552237"');
  expect(await extractVhalVersion(root)).toMatchObject({ version: "22.37" });
  expect(await extractVhalVersion("")).toEqual({ status: "not_configured" });
  expect(await extractVhalVersion(path.join(root, "missing"))).toMatchObject({ status: "unavailable" });
  await fs.writeFile(path.join(root, "type.h"), "invalid");
  expect(await extractVhalVersion(root)).toMatchObject({ status: "unavailable", error: expect.stringContaining("VER_PRO_CFG") });
});

it.each([true, false])("persists configured VHAL after SOC/SCC and passes it to analysis (archive=%s)", async (withArchive) => {
  const { collectEvidence } = await import("@/server/pipeline/process/evidence-stage");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vhal-stage-")); roots.push(root);
  const proto = path.join(root, "configured-proto"); await fs.mkdir(proto);
  const extracted = path.join(root, "extracted"); await fs.mkdir(extracted);
  await fs.writeFile(path.join(proto, "type.h"), '#define VER_PRO_CFG "82552236"');
  await fs.writeFile(path.join(extracted, "Buildinfo.txt"), "MAIN_VERSION=soc");
  const metrics = { counts: {}, evidenceCompleteness: {} };
  const result = await collectEvidence({ request: { basePaths: { proto_dir: proto } }, logRoot: root, issueKey: "TEST-1", ruleGroupId: "g", groupDirName: "g", logger: { log() {} }, metrics } as unknown as Parameters<typeof collectEvidence>[0], {
    classified: (withArchive ? { latestZip: { filename: "log.zip" } } : {}) as Parameters<typeof collectEvidence>[1]["classified"],
    plotPromise: null, signals: { exactMatches: [], recoveredMatches: [], signalIdRecords: [], unmatchedTokens: [] } as unknown as Parameters<typeof collectEvidence>[1]["signals"],
    commentsText: "", extractDir: extracted, canTraceText: "", parsingStarted: null,
  });
  expect(result.androidLog).toContain("VHAL版本：22.36");
  if (withArchive) expect(result.extractMarkdown.indexOf("VHAL版本：22.36")).toBeGreaterThan(result.extractMarkdown.indexOf("SCC版本："));
  const saved = JSON.parse(await fs.readFile(path.join(root, "log-versions.json"), "utf8"));
  expect(saved.vhal).toEqual({ status: "ok", file: path.join(proto, "type.h"), raw: "82552236", platform: "8255", version: "22.36" });
  expect(await fs.readFile(path.join(root, "extract.md"), "utf8")).toBe(result.extractMarkdown);
  expect(await fs.readFile(path.join(root, "step4_android_qnx_input.md"), "utf8")).toContain("VER_PRO_CFG=82552236");
  expect(metrics.evidenceCompleteness).toMatchObject({ androidQnxLogLinesFound: false });
});
