"use client";

import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { RuleGroup } from "@/domain/entities";
import {
  emptyRuleGroupForm, formToRuleGroupInput, ruleGroupToForm, validateRuleGroupForm,
  RULE_GROUP_PROMPT_KEYS, RULE_GROUP_PROMPT_LABEL, type RuleGroupFormValues,
} from "@/domain/rule-groups/form";
import { newId } from "@/shared/lib/ids";
import { errorMessage } from "@/shared/lib/errors";
import {
  Button, Callout, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, Field, Input, Textarea, toast,
} from "@/shared/ui";
import { useRuleGroupStore } from "../store";

interface Props {
  group?: RuleGroup;
  bosch?: boolean;
  readOnly?: boolean;
  onClose: () => void;
}

/** 每次打开由父组件重新挂载，避免编辑不同配置时残留上一次表单。 */
export function RuleGroupDialog({ group, bosch = false, readOnly, onClose }: Props) {
  const isBosch = group ? group.jiraProvider === "bosch" : bosch;
  const [values, setValues] = useState<RuleGroupFormValues>(() => group ? ruleGroupToForm(group, newId) : emptyRuleGroupForm());
  const [errors, setErrors] = useState<{ name?: string; models?: string }>({});
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const patch = <K extends keyof RuleGroupFormValues>(key: K, value: RuleGroupFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending || readOnly) return;
    const validation = validateRuleGroupForm(values);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    setPending(true);
    setFailure(null);
    try {
      const input = formToRuleGroupInput(values, isBosch);
      const store = useRuleGroupStore.getState();
      if (group) await store.update(group.id, input);
      else await store.add(input);
      toast.success(group ? "规则组已更新" : "规则组已创建");
      onClose();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <DialogContent size="lg" onInteractOutside={(event) => event.preventDefault()} hideClose={pending}>
        <DialogHeader>
          <DialogTitle>{readOnly ? "查看规则组" : group ? "编辑规则组" : isBosch ? "新建 Bosch Jira 规则组" : "新建规则组"}</DialogTitle>
          <DialogDescription>配置工单查询、车型文件与分析提示词。{isBosch ? "此规则组使用 Bosch Jira。" : "JQL 与飞书项目 MQL 可独立配置。"}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="flex min-h-0 flex-col">
          <DialogBody className="space-y-5">
            {failure ? <Callout tone="danger">{failure}</Callout> : null}
            <fieldset disabled={pending || readOnly} className="min-w-0 space-y-5">
              <Field label="规则组名称" htmlFor="rg-name" required error={errors.name}>
                <Input id="rg-name" value={values.name} onChange={(e) => patch("name", e.target.value)} autoFocus required />
              </Field>
              <Field label={isBosch ? "Bosch Jira JQL" : "Jira JQL"} htmlFor="rg-jql" hint="留空表示不启用 Jira 来源。">
                <Textarea id="rg-jql" className="font-mono text-xs" value={values.jql} onChange={(e) => patch("jql", e.target.value)} rows={3} />
              </Field>
              {!isBosch ? <Field label="飞书项目 MQL" htmlFor="rg-mql" hint="建议填写含 FROM 数据源的完整 MQL；留空表示不启用飞书来源。">
                <Textarea id="rg-mql" className="font-mono text-xs" value={values.meegleMql} onChange={(e) => patch("meegleMql", e.target.value)} rows={3} />
              </Field> : null}
              <Field label="Jira expand" htmlFor="rg-expand" hint="可选的 Jira 查询展开参数。">
                <Input id="rg-expand" value={values.expand} onChange={(e) => patch("expand", e.target.value)} />
              </Field>
              <details className="rounded-lg border border-border" open>
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium">CAN 配置与车型文件</summary>
                <div className="space-y-4 border-t border-border p-4">
                  {([['json_dir', 'JSON 根目录'], ['dbc_dir', 'DBC 根目录'], ['proto_dir', 'Proto 根目录']] as const).map(([key, label]) => (
                    <Field key={key} label={label} htmlFor={`rg-${key}`}>
                      <Input id={`rg-${key}`} className="font-mono text-xs" value={values.base_paths[key]} onChange={(e) => patch("base_paths", { ...values.base_paths, [key]: e.target.value })} />
                    </Field>
                  ))}
                  {errors.models ? <p role="alert" className="text-xs text-destructive">{errors.models}</p> : null}
                  {values.modelRows.map((row, index) => (
                    <div key={row.rowId} className="space-y-3 rounded-md bg-surface-2 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">车型 {index + 1}</span>
                        {!readOnly ? <Button size="icon" variant="ghost" aria-label={`移除车型 ${index + 1}`} onClick={() => patch("modelRows", values.modelRows.filter((item) => item.rowId !== row.rowId))}><Trash2 aria-hidden /></Button> : null}
                      </div>
                      <Field label="车型别名" htmlFor={`rg-model-${row.rowId}-aliases`} hint="支持逗号、分号或换行分隔；完整匹配且区分大小写。留空时自动识别使用用户默认配置。">
                        <Textarea id={`rg-model-${row.rowId}-aliases`} value={row.aliases ?? ""} rows={2} onChange={(e) => patch("modelRows", values.modelRows.map((item) => item.rowId === row.rowId ? { ...item, aliases: e.target.value } : item))} />
                      </Field>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {([['modelName', '车型名称'], ['json', 'JSON 文件'], ['dbc', 'DBC 文件（逗号分隔）'], ['proto', 'Proto 文件']] as const).map(([key, label]) => (
                          <Field key={key} label={label} htmlFor={`rg-model-${row.rowId}-${key}`}>
                            <Input id={`rg-model-${row.rowId}-${key}`} value={row[key]} onChange={(e) => patch("modelRows", values.modelRows.map((item) => item.rowId === row.rowId ? { ...item, [key]: e.target.value } : item))} />
                          </Field>
                        ))}
                      </div>
                    </div>
                  ))}
                  {!readOnly ? <Button variant="outline" onClick={() => patch("modelRows", [...values.modelRows, { rowId: newId(), modelName: "", json: "", dbc: "", proto: "" }])}><Plus aria-hidden />添加车型</Button> : null}
                </div>
              </details>
              <details className="rounded-lg border border-border">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium">分析提示词（6 项）</summary>
                <div className="space-y-4 border-t border-border p-4">
                  {RULE_GROUP_PROMPT_KEYS.map((key) => (
                    <Field key={key} label={RULE_GROUP_PROMPT_LABEL[key]} htmlFor={`rg-prompt-${key}`}>
                      <Textarea id={`rg-prompt-${key}`} className="font-mono text-xs" rows={5} value={values.prompts[key]} onChange={(e) => patch("prompts", { ...values.prompts, [key]: e.target.value })} />
                    </Field>
                  ))}
                </div>
              </details>
            </fieldset>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose} disabled={pending}>{readOnly ? "关闭" : "取消"}</Button>
            {!readOnly ? <Button variant="primary" type="submit" loading={pending}>保存规则组</Button> : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
