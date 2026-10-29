import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { collectEvidence } from "@/server/pipeline/process/evidence-stage";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
it.each([true, false])("persists extracted hash lines including deduplication and the 20-line limit (hashes=%s)", async (hasHashes) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hash-persist-")); roots.push(root);
  const extracted = path.join(root, "extracted"); await fs.mkdir(extracted);
  const lines = Array.from({ length: 23 }, (_, n) => `2020-01-01 00:00:00 BoschVehicleHalHash: hash-${n}`);
  await fs.writeFile(path.join(extracted, "android.log"), hasHashes ? [lines[0], ...lines].join("\n") : "unrelated");
  const result = await collectEvidence({ request: {}, logRoot: root, issueKey: "TEST-1", ruleGroupId: "g", groupDirName: "g", logger: { log() {} }, metrics: { counts: {}, evidenceCompleteness: {} } } as unknown as Parameters<typeof collectEvidence>[0], {
    classified: { latestZip: { filename: "log.zip" } } as Parameters<typeof collectEvidence>[1]["classified"],
    plotPromise: null, signals: { exactMatches: [], recoveredMatches: [], signalIdRecords: [], unmatchedTokens: [] } as unknown as Parameters<typeof collectEvidence>[1]["signals"],
    commentsText: "", extractDir: extracted, canTraceText: "", parsingStarted: null,
  });
  const saved = JSON.parse(await fs.readFile(path.join(root, "log-versions.json"), "utf8"));
  expect(saved.boschVehicleHalHashLines).toEqual(hasHashes ? lines.slice(0, 20) : []);
  for (const line of saved.boschVehicleHalHashLines) expect(result.androidLog).toContain(line);
  expect(saved).toMatchObject({ schemaVersion: 1, records: [], vhal: { status: "not_configured" } });
});
