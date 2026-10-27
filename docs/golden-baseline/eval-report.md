# Jira 解票准确率评测报告

- 生成时间：2026-10-20T05:38:14.658Z
- 评测票数：49（跳过 0）
- 平均证据接地率 EGR：**95.4%**
- EGR 有效评测票数：40；未知票数：9（未知票不计入均值）
- 平均信号召回率：95.0%
- 平均结论关键判断命中率：78.6%

## 错误归因聚合
- signal_missing: 18
- time_window_mismatch: 15
- log_evidence_missing: 12
- low_confidence_evidence: 7
- ungrounded_conclusion: 3

## 证据来源审计
- `chery D01-8255/D01/meegle-7105128814/PL0C1RIbDYZcpENE5f7di` missingEvidenceSources: extract; evidenceReadErrors: none; evidenceSourceErrors: none
- `chery D01-8255/D01/meegle-7108290559/Lr71JsIK8MlBd1Zkv3P2Z` missingEvidenceSources: evidence_packet, can_signal_summary, can_trace_extracted_result, signals_id, extract; evidenceReadErrors: none; evidenceSourceErrors: none
- `chery D01-8255/D01/meegle-7117523715/9zsU-okLMvPyUnPMhNrdw` missingEvidenceSources: evidence_packet, can_signal_summary, can_trace_extracted_result, signals_id, extract; evidenceReadErrors: none; evidenceSourceErrors: none
- `chery D01-8255/D01/meegle-7117562806/PRzZMqGajlHXqg4e7z9x5` missingEvidenceSources: evidence_packet, can_signal_summary, can_trace_extracted_result, signals_id, extract; evidenceReadErrors: none; evidenceSourceErrors: none
- `chery D01-8255/D01/meegle-7117772893/f9JLS0nB80VL1kwxZfUf4` missingEvidenceSources: extract; evidenceReadErrors: none; evidenceSourceErrors: none
- `chery D01-8255/D01/meegle-7117839963/S--6ekN49TOEvOjycR-_3` missingEvidenceSources: extract; evidenceReadErrors: none; evidenceSourceErrors: none
- `chery D01-8255/D01/meegle-7118037963/ZGNLFqJTErg3Jejyxas6L` missingEvidenceSources: evidence_packet, can_signal_summary, can_trace_extracted_result, signals_id, extract; evidenceReadErrors: none; evidenceSourceErrors: none
- `chery D01-8255/D01/meegle-7125647144/onf49oxJGZvhmvmT21JZD` missingEvidenceSources: extract; evidenceReadErrors: none; evidenceSourceErrors: none
- `chery D01-8255/D01/meegle-7130260820/u-klzwGfWTPnPjXqvA_sv` missingEvidenceSources: evidence_packet, can_signal_summary, can_trace_extracted_result, signals_id, extract; evidenceReadErrors: none; evidenceSourceErrors: none
- `chery D01-8255/D01/meegle-7131893090/5vo7Y6OL-yHJvmWf7Et0u` missingEvidenceSources: extract; evidenceReadErrors: none; evidenceSourceErrors: none
- `chery D01-8255/D01/meegle-7132453568/qQJPsOovSokaQ6zeVSoqe` missingEvidenceSources: evidence_packet, can_signal_summary, can_trace_extracted_result, signals_id, extract; evidenceReadErrors: none; evidenceSourceErrors: none
- `chery D01-8255/D01/meegle-7138339685/pdYluwhaDnzpT2Rv-gJu5` missingEvidenceSources: can_signal_summary, can_trace_extracted_result; evidenceReadErrors: none; evidenceSourceErrors: none
- `chery D01-8255/D01P国际/meegle-7058453085/XxH3XrPHFmHZJviAFj_4o` missingEvidenceSources: extract; evidenceReadErrors: none; evidenceSourceErrors: none
- `chery T1J_FL3-8255/T1J-FL3-8255/meegle-7120953350/PYKJh5VV_jigyq1ZxRudT` missingEvidenceSources: evidence_packet, can_signal_summary, can_trace_extracted_result, signals_id, extract; evidenceReadErrors: none; evidenceSourceErrors: none
- `chery T1J-FL2-8255/T1J_FL2/meegle-7119080671/QN1z2K7QJ8-fHGJ28A9iz` missingEvidenceSources: evidence_packet, can_signal_summary, can_trace_extracted_result, signals_id, extract; evidenceReadErrors: none; evidenceSourceErrors: none
- `chery-8155-others/T1J_FL2_8155/meegle-7121246002/rUTU5cVb6-cb8aGkCt0lo` missingEvidenceSources: can_signal_summary, can_trace_extracted_result; evidenceReadErrors: none; evidenceSourceErrors: none
- `chery-8155-others/unknown/meegle-7047248025/7VYPSpn8N07SdszH4voSA` missingEvidenceSources: can_signal_summary, can_trace_extracted_result, signals_id, extract; evidenceReadErrors: none; evidenceSourceErrors: none
- `chery-8155-others/unknown/meegle-7063561983/HmuZAjq5Wy1KodYdcJ1Op` missingEvidenceSources: can_signal_summary, can_trace_extracted_result, signals_id, extract; evidenceReadErrors: none; evidenceSourceErrors: none
- `chery-8155-others/unknown/meegle-7128871145/Vei8XkhQ3xSkPHwRUE4c7` missingEvidenceSources: can_signal_summary, can_trace_extracted_result, signals_id, extract; evidenceReadErrors: none; evidenceSourceErrors: none
- `maxux/PKK1_PHEV/MXS-29227` missingEvidenceSources: evidence_packet, can_signal_summary, can_trace_extracted_result, signals_id, extract; evidenceReadErrors: none; evidenceSourceErrors: none
- `maxux/unknown/GLY-1693` missingEvidenceSources: can_signal_summary, can_trace_extracted_result, signals_id, extract; evidenceReadErrors: none; evidenceSourceErrors: none
- `maxux/unknown/MXS-29152` missingEvidenceSources: evidence_packet, can_signal_summary, can_trace_extracted_result, signals_id, extract; evidenceReadErrors: none; evidenceSourceErrors: none

## 未接地断言热点（前 20 票）
### `chery D01-8255/D01/meegle-7128979749/Q4sCB97-D5n_4gpQeMGQL`
EGR 67%，分类 ungrounded_conclusion
missingEvidenceSources: none
- rawText: 13:24:20.88; missReason: subject_not_found; checkedEvidenceSources: evidence_packet, can_signal_summary, can_trace_extracted_result, signals_id, extract, input_comments
### `maxux/unknown/GLY-1693`
EGR 50%，分类 log_evidence_missing, ungrounded_conclusion, low_confidence_evidence
missingEvidenceSources: can_signal_summary, can_trace_extracted_result, signals_id, extract
- rawText: carmod=normal; missReason: subject_value_pair_not_found; checkedEvidenceSources: evidence_packet, input_comments
### `maxux/unknown/MXS-29152`
EGR 0%，分类 time_window_mismatch, log_evidence_missing, ungrounded_conclusion, low_confidence_evidence
missingEvidenceSources: evidence_packet, can_signal_summary, can_trace_extracted_result, signals_id, extract
- rawText: 08:05:32.014; missReason: missing_evidence; checkedEvidenceSources: none