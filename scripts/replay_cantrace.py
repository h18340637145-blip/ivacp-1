#!/usr/bin/env python3
"""独立离线 CAN 回放入口，复用流水线解码、时钟、报文周期及绘图实现。

支持 --trace、多个 --dbc、--signals / --signals-json、--proto、--outdir、--json-only。
完整参数见 --help；只读输入trace，不连接CAN总线。
"""
from __future__ import annotations
import argparse
import datetime
import io
import json
import os
import re
import sys
from typing import Any, Dict, List, Optional, Tuple
from plot_can_signals import (
    sanitize_asc, build_merged_database, find_signals_in_db, get_ticks,
    parse_asc_trace, parse_blf_trace, format_trace_timestamp,
    analyze_periodicity, summarize_segments, plot_signals_chart,
)

def parse_proto_property_ids(proto_path: str) -> Dict[str, Dict[str, Any]]:
    """从 .proto 文件解析 Property_ID 枚举，返回 {propName: {decimalId, hexId}}"""
    with io.open(proto_path, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()

    prop_map: Dict[str, Dict[str, Any]] = {}
    enum_start = content.find("enum Property_ID {")
    if enum_start == -1:
        return prop_map

    brace_depth = 0
    enum_end = -1
    for i in range(enum_start, len(content)):
        if content[i] == "{":
            brace_depth += 1
        if content[i] == "}":
            brace_depth -= 1
            if brace_depth == 0:
                enum_end = i + 1
                break
    if enum_end == -1:
        return prop_map

    enum_content = content[enum_start:enum_end]
    for match in re.finditer(r'(\w+)\s*=\s*(\d+);\s*//\s*([^|\n]+)', enum_content):
        prop_name, decimal_text, comment = match.group(1), match.group(2), match.group(3)
        hex_match = re.search(r'(0[xX][0-9a-fA-F]+)', comment)
        prop_map[prop_name] = {
            "decimalId": int(decimal_text),
            "hexId": hex_match.group(1).upper() if hex_match else None,
        }
    return prop_map


# ─── JSON 信号解析 ──────────────────────────────────────────────────────────

def load_signals_from_json(json_path: str) -> List[str]:
    """
    从 signals_id.json 中提取信号名。
    支持格式：
      - 数组: [{"matchedSignals": ["sig1","sig2"], ...}, ...]
      - 简单数组: ["sig1", "sig2"]
    """
    with io.open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    signals = []
    if isinstance(data, list):
        for item in data:
            if isinstance(item, str):
                signals.append(item)
            elif isinstance(item, dict):
                for s in item.get("matchedSignals", []):
                    if s and s not in signals:
                        signals.append(s)
    elif isinstance(data, dict):
        for s in data.get("matchedSignals", []):
            if s and s not in signals:
                signals.append(s)
    return signals


def main():
    parser = argparse.ArgumentParser(
        description="独立 CAN Trace 回放脚本：解码信号并生成时序图",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--trace", required=True, help="CAN trace 文件路径 (.asc / .blf)")
    parser.add_argument("--dbc", action="append", required=True, help="DBC 文件路径（可多次指定）")
    parser.add_argument("--signals", default="", help="逗号分隔的信号名列表")
    parser.add_argument("--signals-json", default="", help="signals_id.json 路径，自动提取信号名")
    parser.add_argument("--proto", default="", help=".proto 文件路径，解析 Property_ID 映射")
    parser.add_argument("--outdir", default="", help="输出目录（默认: trace 文件同目录）")
    parser.add_argument("--json-only", action="store_true", help="只输出 JSON 数据，不画图")
    args = parser.parse_args()

    # 收集信号名
    signal_names: List[str] = []
    if args.signals:
        signal_names.extend(s.strip() for s in args.signals.split(",") if s.strip())
    if args.signals_json:
        if not os.path.isfile(args.signals_json):
            print(f"[ERROR] signals JSON 文件不存在: {args.signals_json}", file=sys.stderr)
            sys.exit(1)
        signal_names.extend(load_signals_from_json(args.signals_json))

    if not signal_names:
        print("[ERROR] 未提供信号名。使用 --signals 或 --signals-json 指定。", file=sys.stderr)
        sys.exit(1)

    # 去重
    signal_names = list(dict.fromkeys(signal_names))

    # 验证文件
    if not os.path.isfile(args.trace):
        print(f"[ERROR] CAN trace 文件不存在: {args.trace}", file=sys.stderr)
        sys.exit(1)

    dbc_paths = [p for p in args.dbc if os.path.isfile(p)]
    if not dbc_paths:
        print(f"[ERROR] 无有效 DBC 文件: {args.dbc}", file=sys.stderr)
        sys.exit(1)

    # 输出目录
    outdir = args.outdir or os.path.dirname(os.path.abspath(args.trace))
    os.makedirs(outdir, exist_ok=True)

    trace_basename = os.path.splitext(os.path.basename(args.trace))[0]

    # Proto 解析
    proto_map: Dict[str, Dict[str, Any]] = {}
    if args.proto:
        if os.path.isfile(args.proto):
            proto_map = parse_proto_property_ids(args.proto)
            print(f"[INFO] 从 proto 解析到 {len(proto_map)} 个 Property_ID 映射", file=sys.stderr)
        else:
            print(f"[WARN] proto 文件不存在: {args.proto}", file=sys.stderr)

    # 加载 DBC
    print(f"[INFO] 加载 DBC: {dbc_paths}", file=sys.stderr)
    db = build_merged_database(dbc_paths)

    # 查找信号
    sigs, messages = find_signals_in_db(db, signal_names)
    if not sigs:
        print(f"[ERROR] 在 DBC 中未找到任何目标信号: {', '.join(signal_names)}", file=sys.stderr)
        # 列出 DBC 中所有可用信号供参考
        all_signals = sorted({sig.name for msg in db.messages for sig in msg.signals})
        if all_signals:
            print(f"[INFO] DBC 中可用信号（前 30 个）: {', '.join(all_signals[:30])}", file=sys.stderr)
        sys.exit(1)

    found_signals = set()
    for slist in sigs.values():
        found_signals.update(slist)
    missing = [s for s in signal_names if s not in found_signals]
    if missing:
        print(f"[WARN] 以下信号未在 DBC 中找到: {', '.join(missing)}", file=sys.stderr)

    print(f"[INFO] 目标信号: {list(found_signals)}", file=sys.stderr)
    print(f"[INFO] 解析 trace: {args.trace}", file=sys.stderr)

    # 解析 trace
    cleaned_asc: Optional[str] = None
    msg_timestamps: Dict[int, List[float]] = {}
    try:
        trace_lower = args.trace.lower()
        if trace_lower.endswith(".asc"):
            cleaned_asc = sanitize_asc(args.trace)
            trace_data, start_time, end_time = parse_asc_trace(cleaned_asc, db, messages, sigs, msg_timestamps)
        elif trace_lower.endswith(".blf"):
            trace_data, start_time, end_time = parse_blf_trace(args.trace, db, messages, sigs, msg_timestamps)
        else:
            print(f"[ERROR] 不支持的 trace 格式: {args.trace}（仅支持 .asc / .blf）", file=sys.stderr)
            sys.exit(1)
    finally:
        if cleaned_asc:
            try:
                os.remove(cleaned_asc)
            except Exception:
                pass

    if not trace_data:
        print("[WARN] 未解码到任何信号数据。", file=sys.stderr)
        sys.exit(0)

    total_pts = sum(len(v["y"]) for v in trace_data.values())
    print(f"[INFO] 解码完成: {len(trace_data)} 个信号, 共 {total_pts} 个数据点", file=sys.stderr)
    print(f"[INFO] 时间范围: {format_trace_timestamp(start_time)} ~ {format_trace_timestamp(end_time)}", file=sys.stderr)

    # 报文特性分析
    id_to_msg: Dict[int, Tuple[str, Any]] = {}
    for msg_name, msg in messages.items():
        id_to_msg[msg.frame_id] = (msg_name, msg)
    characteristics = {}
    for arb_id, ts_list in msg_timestamps.items():
        entry = id_to_msg.get(arb_id)
        if entry:
            msg_name, msg = entry
            char_res = analyze_periodicity(ts_list)
            characteristics[msg_name] = {
                "frame_id": hex(arb_id),
                **char_res,
            }

    # Summary
    summary_text = summarize_segments(trace_data)
    tick_info = get_ticks(messages, sigs)

    # 构建输出 JSON
    result = {
        "trace_file": os.path.abspath(args.trace),
        "dbc_files": [os.path.abspath(p) for p in dbc_paths],
        "requested_signals": signal_names,
        "traceStartTime": format_trace_timestamp(start_time),
        "traceEndTime": format_trace_timestamp(end_time),
        "summary": summary_text,
        "msg_characteristics": characteristics,
        "ticks": tick_info,
        "trace_data": {
            key: {
                "x": [dt.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] if isinstance(dt, datetime.datetime) else dt for dt in val["x"]],
                "y": val["y"],
            }
            for key, val in trace_data.items()
        },
    }

    # Proto 映射附加
    if proto_map:
        result["proto_property_ids"] = proto_map

    # 写 JSON
    json_path = os.path.join(outdir, f"{trace_basename}_replay.json")
    with io.open(json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"[OK] JSON 结果: {json_path}", file=sys.stderr)

    # 写 summary
    summary_path = os.path.join(outdir, f"{trace_basename}_summary.txt")
    with io.open(summary_path, "w", encoding="utf-8") as f:
        f.write(summary_text)
    print(f"[OK] 信号摘要: {summary_path}", file=sys.stderr)

    # 画图
    if not args.json_only:
        png_path = os.path.join(outdir, f"{trace_basename}_signals.png")
        plotted = plot_signals_chart(trace_data, tick_info, png_path, start_time, os.path.basename(args.trace))
        if plotted:
            print(f"[OK] 时序图: {png_path}", file=sys.stderr)
        else:
            print("[WARN] 未生成时序图（无数据）", file=sys.stderr)

    # stdout 输出简要结果
    print(json.dumps({
        "json": json_path,
        "summary": summary_path,
        "image": os.path.join(outdir, f"{trace_basename}_signals.png") if not args.json_only else "",
        "signals_found": list(found_signals),
        "signals_missing": missing,
        "total_points": total_pts,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
