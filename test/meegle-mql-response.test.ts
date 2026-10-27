import { describe, expect, it } from "vitest";
import { extractMeegleMqlItems } from "@/server/meegle/mql-response";

describe("飞书 MQL 响应解析", () => {
  it("data={}、list=null 是合法空结果", () => {
    expect(extractMeegleMqlItems({
      data: {},
      extra_info: null,
      list: null,
      search_status_info: null,
      session_id: "120260818133600DD7CFC353CB4D80F1C53",
    })).toEqual([]);
  });

  it("展开 moql_field_list 分组结果；错误响应返回 undefined", () => {
    expect(extractMeegleMqlItems({
      data: { "1": [{ moql_field_list: [{ key: "work_item_id", value: { long_value: 42 } }, { key: "name", value: { string_value: "工单" } }] }] },
    })).toEqual([{ work_item_id: 42, name: "工单" }]);
    expect(extractMeegleMqlItems({ error: { code: "X" } })).toBeUndefined();
  });
});
