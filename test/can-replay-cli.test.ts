import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, it } from "vitest";
const exec = promisify(execFile);
it.skipIf(!process.env.CAN_PYTHON_BIN)("独立CAN回放保留JSON信号、proto映射、摘要和绘图，复用流水线解码器", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ivacp-replay-"));
  try {
    const dbc = path.join(root, "sample.dbc"), trace = path.join(root, "sample.asc"), signals = path.join(root, "signals.json"), proto = path.join(root, "vehicle.proto"), out = path.join(root, "out");
    await writeFile(dbc, 'VERSION ""\nNS_ :\nBS_:\nBU_: Vector__XXX\nBO_ 256 Status: 8 Vector__XXX\n SG_ State : 0|8@1+ (1,0) [0|255] "" Vector__XXX\n');
    await writeFile(trace, 'date Mon Oct 26 09:00:00.000 AM 2026\nbase hex timestamps absolute\ninternal events logged\n0.000000 1 100 Rx d 8 01 00 00 00 00 00 00 00\n0.100000 1 100 Rx d 8 02 00 00 00 00 00 00 00\n');
    await writeFile(signals, JSON.stringify([{ matchedSignals: ["State"] }])); await writeFile(proto, 'enum Property_ID {\n STATE = 123; // 0x7B\n}\n');
    const args = [path.resolve("scripts/replay_cantrace.py"), "--trace", trace, "--dbc", dbc, "--signals-json", signals, "--proto", proto, "--outdir", out];
    const result = JSON.parse((await exec(process.env.CAN_PYTHON_BIN!, [...args, "--json-only"])).stdout);
    expect(result).toMatchObject({ image: "", signals_found: ["State"], total_points: 2 }); const data = JSON.parse(await readFile(result.json, "utf8")); expect(Object.values(data.trace_data).flatMap(entry => (entry as { y: number[] }).y)).toEqual([1, 2]); expect(data.proto_property_ids.STATE.decimalId).toBe(123); expect(await readFile(result.summary, "utf8")).toContain("State");
    const chart = JSON.parse((await exec(process.env.CAN_PYTHON_BIN!, args)).stdout); expect((await readFile(chart.image)).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  } finally { await rm(root, { recursive: true, force: true }); }
});
