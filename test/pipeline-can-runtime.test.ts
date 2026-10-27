import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
const exec = promisify(execFile);
describe("CAN runtime", () => {
 it.skipIf(!process.env.CAN_PYTHON_BIN).each(["asc", "blf", "canfd"])("decodes a real %s fixture through DBC and produces chart evidence", async (format) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ivacp-can-"));
  try {
   const dbc = path.join(directory, "sample.dbc"); const trace = path.join(directory, format === "blf" ? "trace.blf" : "trace.asc"); const image = path.join(directory, "chart.png");
   await fs.writeFile(dbc, 'VERSION ""\nNS_ :\nBS_:\nBU_: Vector__XXX\nBO_ 256 Status: 8 Vector__XXX\n SG_ State : 0|8@1+ (1,0) [0|255] "" Vector__XXX\n');
   await fs.writeFile(trace, 'date Mon Oct 26 09:00:00.000 AM 2026\nbase hex timestamps absolute\ninternal events logged\n   0.000000 1 100 Rx d 8 01 00 00 00 00 00 00 00\n   0.100000 1 100 Rx d 8 02 00 00 00 00 00 00 00\n   0.200000 1 100 Rx d 8 02 00 00 00 00 00 00 00\n');
   if (format === "blf") {
    await exec(process.env.CAN_PYTHON_BIN!, ["-c", "import can,sys; writer=can.BLFWriter(sys.argv[1]); [writer.on_message_received(can.Message(timestamp=1792976400+i/10, arbitration_id=256, is_extended_id=False, data=[value,0,0,0,0,0,0,0])) for i,value in enumerate([1,2,2])]; writer.stop()", trace]);
   }
   if (format === "canfd") {
    const bytes = (value: number) => [value.toString(16).padStart(2, "0"), ...Array(63).fill("00")].join(" ");
    await fs.writeFile(trace, `date Mon Oct 26 09:00:00.000 AM 2026\nbase hex timestamps absolute\n${[1, 2, 2].map((value, index) => `${(index / 10).toFixed(6)} CANFD 1 100 Rx 1 0 d 15 64 ${bytes(value)}`).join("\n")}\n`);
   }
   const { stdout } = await exec(process.execPath, ["scripts/plot_can_signals.js", "--trace", trace, "--dbc", dbc, "--signals", "State", "--output", image], { env: process.env, timeout: 60_000 });
   const result = JSON.parse(stdout);
   expect(result.image).toBe(image); expect(result.summary).toContain("State");
   expect(Object.values(result.trace_data).flatMap((entry) => (entry as { y: number[] }).y)).toEqual([1, 2, 2]);
   expect((await fs.readFile(image)).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
 }, 60_000);
});
