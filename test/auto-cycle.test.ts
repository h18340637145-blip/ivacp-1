import { describe, expect, it } from "vitest";
import {
  clampAutoCycleInterval,
  isAutoCycleDue,
  markAutoCycleRan,
  toggleAutoCycleState,
  updateAutoCycleInterval,
} from "@/domain/rule-groups/auto-cycle";

const now = new Date("2025-03-01T08:00:00Z");

describe("auto cycle", () => {
  it("clamps interval", () => {
    expect(clampAutoCycleInterval(1)).toBe(5);
    expect(clampAutoCycleInterval(12.6)).toBe(13);
    expect(clampAutoCycleInterval(Number.NaN)).toBe(30);
  });

  it("toggles on with immediate due time", () => {
    const state = toggleAutoCycleState(undefined, "g1", true, now);
    expect(state).toMatchObject({ ruleGroupId: "g1", isActive: true, intervalMinutes: 30 });
    expect(state.nextRunAt).toEqual(now);
    expect(isAutoCycleDue(state, now.getTime())).toBe(true);
    const off = toggleAutoCycleState(state, "g1", false, now);
    expect(isAutoCycleDue(off, now.getTime())).toBe(false);
  });

  it("keeps existing next run on re-activation", () => {
    const future = new Date(now.getTime() + 60_000);
    const state = toggleAutoCycleState(
      { ruleGroupId: "g1", isActive: false, intervalMinutes: 10, nextRunAt: future },
      "g1",
      true,
      now,
    );
    expect(state.nextRunAt).toEqual(future);
    expect(isAutoCycleDue(state, now.getTime())).toBe(false);
  });

  it("reschedules active cycle when interval changes", () => {
    const active = toggleAutoCycleState(undefined, "g1", true, now);
    const updated = updateAutoCycleInterval(active, "g1", 10, now);
    expect(updated.intervalMinutes).toBe(10);
    expect(updated.nextRunAt).toEqual(new Date(now.getTime() + 10 * 60_000));
    const inactive = updateAutoCycleInterval(undefined, "g1", 3, now);
    expect(inactive).toMatchObject({ isActive: false, intervalMinutes: 5, nextRunAt: undefined });
  });

  it("marks run", () => {
    const ran = markAutoCycleRan({ ruleGroupId: "g1", isActive: true, intervalMinutes: 15 }, now);
    expect(ran.lastRunAt).toEqual(now);
    expect(ran.nextRunAt).toEqual(new Date(now.getTime() + 15 * 60_000));
  });
});
