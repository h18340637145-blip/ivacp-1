type UnknownRecord = Record<string, unknown>;

function isPlainRecord(value: unknown): value is UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function flattenMoqlItem(item: unknown): unknown {
  const record = isPlainRecord(item) ? item : undefined;
  if (!record) return item;
  const fields = record.moql_field_list;
  if (!Array.isArray(fields)) return item;
  const flat: UnknownRecord = {};
  for (const field of fields) {
    if (!isPlainRecord(field) || typeof field.key !== "string") continue;
    const val = isPlainRecord(field.value) ? field.value : undefined;
    if (val) {
      flat[field.key] = val.long_value ?? val.string_value ?? val.double_value ?? val.bool_value ?? val.date_value ?? val.list_value ?? val.value ?? null;
    }
  }
  return flat;
}

/**
 * Normalizes the shapes returned by `meegle workitem query`.
 * A query with no matching work item is represented as `data: {}` and
 * `list: null`, which is a successful zero-item result rather than an error.
 */
export function extractMeegleMqlItems(value: unknown): unknown[] | undefined {
  const result = isPlainRecord(value) ? value : undefined;
  if (!result) return undefined;
  if (result.error && isPlainRecord(result.error) && result.error.code) return undefined;

  const data = isPlainRecord(result.data) ? result.data : undefined;
  if (data) {
    const numericGroupKeys = Object.keys(data).filter((key) => /^\d+$/.test(key) && Array.isArray(data[key]));
    if (numericGroupKeys.length > 0) {
      return numericGroupKeys.flatMap((key) => (data[key] as unknown[]).map(flattenMoqlItem));
    }
    if (Array.isArray(data.list)) return data.list.map(flattenMoqlItem);
    if (Array.isArray(data.items)) return data.items.map(flattenMoqlItem);
    if (Object.keys(data).length === 0 && result.list === null) return [];
  }

  if (Array.isArray(result.list)) {
    const first = result.list[0];
    if (isPlainRecord(first) && (first.moql_field_list || first.work_item_id)) return result.list.map(flattenMoqlItem);
  }

  if (typeof result.count === "number" || (data && typeof data.count === "number")) return [];
  return undefined;
}
