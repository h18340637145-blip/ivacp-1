import { describe, expect, it } from "vitest";
import { modelAliasCandidates, resolveModelAlias } from "@/domain/rule-groups/model-files";
const config = (aliases?: string[]) => ({ json: "", dbc: [], proto: "", ...(aliases ? { aliases } : {}) });

describe("规则组别名完整匹配", () => {
  it("唯一车型命中并忽略同车型重复别名", () => {
    const files = { "T1J-FL3-8255": config(["T1JFL3", "T1JFL3"]) };
    expect(modelAliasCandidates("T1JFL3", files)).toEqual(["T1J-FL3-8255"]);
    expect(resolveModelAlias("T1JFL3", files)).toBe("T1J-FL3-8255");
  });
  it.each(["t1jfl3", "T1J_FL3", "T1JFL3_FUEL", "T1JFL", " T1JFL3", ""]) ("原文不完全相等时拒绝匹配 %j", token => {
    const files = { M: config(["T1JFL3"]) };
    expect(modelAliasCandidates(token, files)).toEqual([]);
    expect(resolveModelAlias(token, files)).toBeUndefined();
  });
  it("跨车型相同别名返回全部候选并拒绝唯一解析", () => {
    const files = { M: config(["T1JFL3"]), N: config(["T1JFL3"]) };
    expect(modelAliasCandidates("T1JFL3", files)).toEqual(["M", "N"]);
    expect(resolveModelAlias("T1JFL3", files)).toBeUndefined();
  });
  it("旧车型键和空白别名均不成为隐式别名", () => {
    expect(modelAliasCandidates("M", { M: config() })).toEqual([]);
    expect(modelAliasCandidates("", { M: config([""]) })).toEqual([]);
  });
});
