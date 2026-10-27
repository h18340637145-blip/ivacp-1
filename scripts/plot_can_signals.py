#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CAN Trace 信号绘图脚本
从 ASC/BLF 文件中解码指定信号并生成时序图 PNG。

Usage:
  python3 plot_can_signals.py \
    --trace <trace_file_path> \
    --dbc <dbc1.dbc> [--dbc <dbc2.dbc>] \
    --signals "SignalA,SignalB,SignalC" \
    --output <output.png>

Output (stdout): JSON with keys:
  - "image": output PNG path (or "" if no data)
  - "summary": signal transition summary text (Chinese)
  - "error": error message if failed
  - "traceStartTime": recording start time in local time
  - "traceEndTime": recording end time in local time
"""
from __future__ import annotations

import argparse
import io
import json
import math
import os
import re
import sys
import tempfile
import time
import datetime
import calendar
from typing import Dict, List, Any, Tuple, Optional

import cantools
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import numpy as np
from can.io import ASCReader, BLFReader


# ─── ASC Sanitize ───────────────────────────────────────────────────────────

def sanitize_asc(path: str) -> str:
    """
    Generate a cleaned ASC file removing remote frames, error frames, etc.
    Returns path to cleaned temp file.
    """
    fd, out_path = tempfile.mkstemp(suffix=".asc", prefix="asc_clean_")
    os.close(fd)

    drop_re = re.compile(
        r"\b[RT]x\s+r\b|\b[RT]x\s+R\b|\bErrorFrame\b|\bError\s+Passive\b"
        r"|\bBus\s+Off\b|\bOverrun\b|\bEnd\s+Triggerblock\b",
        flags=re.IGNORECASE,
    )

    with io.open(path, "r", encoding="utf-8", errors="ignore") as fin, \
         io.open(out_path, "w", encoding="utf-8") as fout:
        for line in fin:
            if not drop_re.search(line):
                fout.write(line)

    return out_path


# ─── DBC helpers ────────────────────────────────────────────────────────────

def build_merged_database(dbc_paths: List[str]) -> cantools.database.Database:
    db = cantools.database.Database()
    for p in dbc_paths:
        try:
            db.add_dbc_file(p)
        except Exception as e:
            print(f"[WARN] Failed to load DBC: {p}: {e}", file=sys.stderr)
    return db


def find_signals_in_db(
    db: cantools.database.Database, signal_names: List[str]
) -> Tuple[Dict[str, List[str]], Dict[str, Any]]:
    """
    Search all messages for the given signal names.
    Returns:
      sigs: {msg_name: [signal_name, ...]}
      messages: {msg_name: message_object}
    """
    sigs: Dict[str, List[str]] = {}
    messages: Dict[str, Any] = {}

    for msg in db.messages:
        for sig in msg.signals:
            if sig.name in signal_names:
                sigs.setdefault(msg.name, []).append(sig.name)
                messages[msg.name] = msg

    return sigs, messages


def get_ticks(messages: Dict[str, Any], sigs: Dict[str, List[str]]) -> Dict[str, Any]:
    """Extract enum/choice tick info for signals that have defined value tables."""
    ticks = {}
    for msg_name, msg in messages.items():
        for sig in msg.signals:
            if sig.name in sigs.get(msg_name, []):
                if sig.choices:
                    y_ticks = []
                    y_labs = []
                    for key, val in sig.choices.items():
                        y_ticks.append(key)
                        y_labs.append(f"{val}:{key}")
                    key_name = f"{msg_name}({hex(msg.frame_id)}):{sig.name}"
                    ticks[key_name] = {"labels": y_labs, "ticks": y_ticks}
    return ticks


# ─── Parse and decode ───────────────────────────────────────────────────────

def decode_can_frame(
    frame: Any,
    db: cantools.database.Database,
    id_to_msg: Dict[int, Tuple[str, Any]],
    sigs: Dict[str, List[str]],
    store: Dict[str, Any],
) -> None:
    """Decode one python-can frame into the signal store."""
    arb_id = getattr(frame, "arbitration_id", None)
    data = getattr(frame, "data", None)
    if arb_id is None or data is None:
        return

    entry = id_to_msg.get(arb_id)
    if not entry:
        return

    msg_name, msg = entry
    try:
        decoded = db.decode_message(msg.frame_id, data, decode_choices=False)
    except Exception:
        return

    if not decoded:
        return

    timestamp = getattr(frame, "timestamp", 0.0)
    for sig_name in sigs.get(msg_name, []):
        if sig_name in decoded:
            key = f"{msg_name}({hex(msg.frame_id)}):{sig_name}"
            if key not in store:
                store[key] = {"x": [], "y": []}
            store[key]["x"].append(
                trace_datetime_from_timestamp(timestamp)
            )
            store[key]["y"].append(decoded[sig_name])


def parse_asc_trace(
    asc_path: str, db: cantools.database.Database,
    messages: Dict[str, Any], sigs: Dict[str, List[str]],
    msg_timestamps: Dict[int, List[float]]
) -> Tuple[Dict[str, Any], float, float]:
    """
    Parse ASC file and decode target signals.
    Returns store: {key: {x: [datetime], y: [value]}}, start_time, end_time
    """
    store: Dict[str, Any] = {}
    start_time = 0.0
    end_time = 0.0
    index = 0

    # Build frame_id -> (msg_name, msg) mapping for fast lookup
    id_to_msg: Dict[int, Tuple[str, Any]] = {}
    for msg_name, msg in messages.items():
        id_to_msg[msg.frame_id] = (msg_name, msg)

    try:
        with ASCReader(asc_path, relative_timestamp=False) as reader:
            for frame in reader:
                try:
                    if index == 0:
                        start_time = frame.timestamp
                    index += 1
                    end_time = getattr(frame, "timestamp", end_time)

                    arb_id = getattr(frame, "arbitration_id", None)
                    if arb_id is not None and arb_id in id_to_msg:
                        msg_timestamps.setdefault(arb_id, []).append(frame.timestamp)

                    decode_can_frame(frame, db, id_to_msg, sigs, store)
                except (ValueError, TypeError, AttributeError):
                    # Skip individual frames that fail to parse
                    continue
    except Exception as e:
        print(f"[WARN] ASC parse error: {e}", file=sys.stderr)
        # If we got some data before error, still return it
        if not store:
            # Try fallback: manual line-by-line parsing for CANFD
            store, start_time, end_time = parse_asc_manual(asc_path, db, id_to_msg, sigs, msg_timestamps)

    return store, start_time, end_time


def parse_blf_trace(
    blf_path: str, db: cantools.database.Database,
    messages: Dict[str, Any], sigs: Dict[str, List[str]],
    msg_timestamps: Dict[int, List[float]]
) -> Tuple[Dict[str, Any], float, float]:
    """
    Parse BLF file and decode target signals through python-can's BLFReader.
    Returns store: {key: {x: [datetime], y: [value]}}, start_time, end_time
    """
    store: Dict[str, Any] = {}
    start_time = 0.0
    end_time = 0.0
    index = 0

    id_to_msg: Dict[int, Tuple[str, Any]] = {}
    for msg_name, msg in messages.items():
        id_to_msg[msg.frame_id] = (msg_name, msg)

    try:
        with BLFReader(blf_path) as reader:
            for frame in reader:
                try:
                    if index == 0:
                        start_time = getattr(frame, "timestamp", 0.0)
                    index += 1
                    end_time = getattr(frame, "timestamp", end_time)

                    arb_id = getattr(frame, "arbitration_id", None)
                    if arb_id is not None and arb_id in id_to_msg:
                        msg_timestamps.setdefault(arb_id, []).append(getattr(frame, "timestamp", 0.0))

                    decode_can_frame(frame, db, id_to_msg, sigs, store)
                except (ValueError, TypeError, AttributeError):
                    continue
    except Exception as e:
        print(f"[WARN] BLF parse error: {e}", file=sys.stderr)

    return store, start_time, end_time


def parse_asc_manual(
    asc_path: str, db: cantools.database.Database,
    id_to_msg: Dict[int, Tuple[str, Any]], sigs: Dict[str, List[str]],
    msg_timestamps: Dict[int, List[float]]
) -> Tuple[Dict[str, Any], float, float]:
    """
    Fallback manual ASC/CANFD parser for when python-can't ASCReader fails.
    Handles format: <timestamp> CANFD <ch> <id_hex> Rx <flags> <dlc_code> <data_bytes...>
    Also handles: <timestamp> <ch> <id_hex> Rx d <dlc> <data_bytes...>
    """
    store: Dict[str, Any] = {}
    start_time = 0.0
    end_time = 0.0
    index = 0

    # Pattern for CANFD: 0.000000 CANFD 1 42f Rx 1 0 d 14 48 00 00 ...
    # In Vector ASC CANFD, the token after "d <dlc>" is payload length, not data.
    canfd_re = re.compile(
        r'^\s*([\d.]+)\s+CANFD\s+\d+\s+([0-9a-fA-F]+)\s+[RT]x\s+'
        r'(?:\d+\s+\d+\s+)?d\s+(\d+)\s+\d+\s+((?:[0-9a-fA-F]{2}\s*)+)',
        re.IGNORECASE,
    )
    # Pattern for classic CAN: 0.000000 1 42f Rx d 8 00 00 00 ...
    classic_re = re.compile(
        r'^\s*([\d.]+)\s+\d+\s+([0-9a-fA-F]+)\s+[RT]x\s+d\s+(\d+)\s+'
        r'((?:[0-9a-fA-F]{2}\s*)+)',
        re.IGNORECASE,
    )

    # Get ASC base timestamp from header
    base_ts = 0.0
    header_re = re.compile(r'^date\s+(.+)', re.IGNORECASE)

    with io.open(asc_path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            # Try to get date from header
            hm = header_re.match(line)
            if hm:
                try:
                    dt = datetime.datetime.strptime(hm.group(1).strip(), "%a %b %d %I:%M:%S %p %Y")
                    base_ts = trace_epoch_from_datetime(dt)
                except Exception:
                    try:
                        dt = datetime.datetime.strptime(hm.group(1).strip(), "%a %b %d %H:%M:%S %p %Y")
                        base_ts = trace_epoch_from_datetime(dt)
                    except Exception:
                        pass
                continue

            m = canfd_re.match(line) or classic_re.match(line)
            if not m:
                continue

            try:
                ts = float(m.group(1))
                can_id = int(m.group(2), 16)
                # dlc = int(m.group(3))  # not needed directly
                data_hex = m.group(4).strip().split()
                data = bytes(int(b, 16) for b in data_hex)
            except (ValueError, TypeError):
                continue

            if index == 0:
                start_time = base_ts + ts if base_ts > 0 else ts
            index += 1
            end_time = base_ts + ts if base_ts > 0 else ts

            entry = id_to_msg.get(can_id)
            if not entry:
                continue

            if can_id in id_to_msg:
                abs_ts = base_ts + ts if base_ts > 0 else ts
                msg_timestamps.setdefault(can_id, []).append(abs_ts)

            msg_name, msg = entry
            try:
                decoded = db.decode_message(msg.frame_id, data, decode_choices=False)
            except Exception:
                continue

            if not decoded:
                continue

            abs_ts = base_ts + ts if base_ts > 0 else ts
            for sig_name in sigs.get(msg_name, []):
                if sig_name in decoded:
                    key = f"{msg_name}({hex(msg.frame_id)}):{sig_name}"
                    if key not in store:
                        store[key] = {"x": [], "y": []}
                    store[key]["x"].append(
                        trace_datetime_from_timestamp(abs_ts)
                    )
                    store[key]["y"].append(decoded[sig_name])

    return store, start_time, end_time


def trace_epoch_from_datetime(value: datetime.datetime) -> float:
    return float(calendar.timegm(value.timetuple())) + value.microsecond / 1_000_000


def trace_datetime_from_timestamp(timestamp: float) -> datetime.datetime:
    return datetime.datetime.utcfromtimestamp(timestamp)


def format_trace_timestamp(timestamp: float) -> str:
    if timestamp <= 0:
        return ""
    return trace_datetime_from_timestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def analyze_periodicity(timestamps: List[float]) -> Dict[str, Any]:
    """
    分析报文发送时间戳，提取特性：
    - 快发周期 (ms)
    - 慢发周期 (ms)
    - 快发帧数
    - 报文类型 (event, cycle, ce)
    """
    result = {
        "fast_period": 0,
        "slow_period": 0,
        "fast_frames": 0,
        "msg_type": "event"
    }
    
    if len(timestamps) < 2:
        return result
        
    # 计算相邻时间差，单位 ms
    diffs = []
    for i in range(1, len(timestamps)):
        d = (timestamps[i] - timestamps[i-1]) * 1000.0
        if d > 1.0: # 忽略小于 1ms 的极小间隔
            diffs.append(d)
            
    if len(diffs) < 1:
        return result
        
    median_diff = np.median(diffs)
    min_diff = np.min(diffs)
    max_diff = np.max(diffs)
    
    # 过滤掉偶发的大间隔
    normal_diffs = [d for d in diffs if d < median_diff * 5.0]
    if not normal_diffs:
        normal_diffs = diffs
        
    std_diff = np.std(normal_diffs)
    mean_diff = np.mean(normal_diffs)
    
    COMMON_PERIODS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000]
    def align_period(val):
        if val <= 0:
            return 0
        closest = min(COMMON_PERIODS, key=lambda x: abs(x - val))
        if abs(closest - val) / closest < 0.25:
            return closest
        return int(round(val))

    # Cycle 判定
    if len(normal_diffs) >= 3 and (std_diff / mean_diff < 0.15 or (max(normal_diffs) - min(normal_diffs)) < 15.0):
        result["msg_type"] = "cycle"
        result["slow_period"] = align_period(mean_diff)
        return result
        
    # CE 判定
    # 假设快发周期在 10ms ~ 100ms，慢发周期 >= 120ms
    fast_list = [d for d in diffs if d < 120.0]
    slow_list = [d for d in diffs if d >= 120.0]
    
    if len(fast_list) >= 2 and len(slow_list) >= 1:
        median_fast = np.median(fast_list)
        median_slow = np.median(slow_list)
        if median_slow > median_fast * 2.5:
            result["msg_type"] = "ce"
            result["fast_period"] = align_period(median_fast)
            result["slow_period"] = align_period(median_slow)
            
            # 计算连续快发的最大间隔数
            max_consecutive_fast = 0
            current_consecutive = 0
            for d in diffs:
                if d < 120.0:
                    current_consecutive += 1
                else:
                    if current_consecutive > 0:
                        max_consecutive_fast = max(max_consecutive_fast, current_consecutive)
                        current_consecutive = 0
            if current_consecutive > 0:
                max_consecutive_fast = max(max_consecutive_fast, current_consecutive)
                
            result["fast_frames"] = max_consecutive_fast + 1 if max_consecutive_fast > 0 else 0
            return result
            
    if len(slow_list) >= 3 and np.std(slow_list) / np.mean(slow_list) < 0.2:
        result["msg_type"] = "cycle"
        result["slow_period"] = align_period(np.mean(slow_list))
    else:
        result["msg_type"] = "event"
        
    return result


# ─── Summary ────────────────────────────────────────────────────────────────

def summarize_segments(trace_data: Dict[str, Any]) -> str:
    """Generate Chinese text summary of signal value transitions."""
    lines = []
    for key, data in trace_data.items():
        # Extract signal name from key like "MsgName(0x123):SignalName"
        m = re.match(r'[^:]+:(.+)', key)
        signal_name = m.group(1) if m else key

        xs = data["x"]
        ys = data["y"]
        if not ys:
            continue

        current_y = ys[0]
        current_start = xs[0]
        current_count = 1

        for i in range(1, len(ys)):
            if ys[i] == current_y:
                current_count += 1
            else:
                start_str = current_start.strftime("%H:%M:%S.%f")[:-3]
                end_str = xs[i - 1].strftime("%H:%M:%S.%f")[:-3]
                lines.append(
                    f"{signal_name} = {current_y}，持续 {current_count} 帧"
                    f"（{start_str} ~ {end_str}）"
                )
                current_y = ys[i]
                current_start = xs[i]
                current_count = 1

        # Last segment
        if current_count > 0:
            start_str = current_start.strftime("%H:%M:%S.%f")[:-3]
            end_str = xs[-1].strftime("%H:%M:%S.%f")[:-3]
            lines.append(
                f"{signal_name} = {current_y}，持续 {current_count} 帧"
                f"（{start_str} ~ {end_str}）"
            )

    return "\n".join(lines)


def summarize_missing(signal_names: List[str], trace_data: Dict[str, Any]) -> str:
    """Report which requested signals were NOT found in the trace."""
    found_signals = set()
    for key in trace_data.keys():
        m = re.match(r'[^:]+:(.+)', key)
        if m:
            found_signals.add(m.group(1))

    missing = [s for s in signal_names if s not in found_signals]
    if missing:
        return "未在 CAN trace 中找到的信号：" + "、".join(missing)
    return ""


# ─── Plotting ───────────────────────────────────────────────────────────────

def plot_signals_chart(
    trace_data: Dict[str, Any],
    ticks: Dict[str, Any],
    output_path: str,
    start_time: float,
    trace_filename: str,
) -> bool:
    """Generate subplot chart and save to output_path. Returns True if saved."""
    if not trace_data:
        return False

    # Configure Chinese font if available, otherwise fallback
    try:
        matplotlib.rc("font", family="WenQuanYi Micro Hei", weight="bold")
    except Exception:
        pass

    n = len(trace_data)

    if start_time > 1.0:
        start_label = f"Start: {format_trace_timestamp(start_time)[:-4]}"
    else:
        first_data = next(iter(trace_data.values()))
        start_label = f"Start: {first_data['x'][0].strftime('%Y-%m-%d %H:%M:%S')}"

    colors = ["#e74c3c", "#2ecc71", "#3498db", "#9b59b6", "#f39c12", "#1abc9c", "#34495e"]

    if n == 1:
        fig, ax = plt.subplots(figsize=(12, 4))
        axs = [ax]
    else:
        fig, axs = plt.subplots(n, 1, sharex=True, figsize=(12, max(3 * n, 6)))
        if n == 1:
            axs = [axs]

    fig.suptitle(trace_filename, fontsize=10)

    for idx, (key, data) in enumerate(trace_data.items()):
        ax = axs[idx]
        color = colors[idx % len(colors)]
        ax.scatter(data["x"], data["y"], color=color, s=10, alpha=0.75,
                   label=f"{key} ({len(data['x'])} pts)")
        ax.legend(loc="upper right", fontsize=8)
        ax.grid(True, alpha=0.3)
        ax.set_ylabel(key.split(":")[-1], fontsize=8)

        # Apply enum ticks if available
        tick_info = ticks.get(key)
        tick_values = tick_info.get("ticks", []) if tick_info else []
        finite_values = [value for value in data["y"] if isinstance(value, (int, float)) and math.isfinite(value)]
        if (
            len(tick_values) >= 2
            and finite_values
            and min(finite_values) >= min(tick_values)
            and max(finite_values) <= max(tick_values)
        ):
            ax.set_yticks(tick_info["ticks"])
            ax.set_yticklabels(tick_info["labels"], fontsize=7)

    # Format x-axis
    axs[-1].xaxis.set_major_formatter(mdates.DateFormatter("%H:%M:%S"))
    axs[-1].set_xlabel(start_label, fontsize=9)
    fig.autofmt_xdate(rotation=30)
    plt.tight_layout()
    plt.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    return True


# ─── Main ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Plot CAN signals from ASC/BLF file")
    parser.add_argument("--trace", required=True, help="Path to .asc or .blf CAN trace file")
    parser.add_argument("--dbc", action="append", required=True, help="Path to .dbc file (can repeat)")
    parser.add_argument("--signals", required=True, help="Comma-separated signal names")
    parser.add_argument("--output", required=True, help="Output PNG path")
    args = parser.parse_args()

    signal_names = [s.strip() for s in args.signals.split(",") if s.strip()]
    if not signal_names:
        print(json.dumps({"image": "", "summary": "", "error": "No signals provided"}))
        return

    # Filter only existing DBC files
    dbc_paths = [p for p in args.dbc if os.path.isfile(p)]
    if not dbc_paths:
        print(json.dumps({"image": "", "summary": "", "error": f"No valid DBC files found: {args.dbc}"}))
        return

    if not os.path.isfile(args.trace):
        print(json.dumps({"image": "", "summary": "", "error": f"CAN trace file not found: {args.trace}"}))
        return

    # 1. Load DBC
    db = build_merged_database(dbc_paths)

    # 2. Find signals in DBC
    sigs, messages = find_signals_in_db(db, signal_names)
    if not sigs:
        print(json.dumps({
            "image": "",
            "summary": f"在 DBC 中未找到任何目标信号：{', '.join(signal_names)}",
            "error": "",
        }))
        return

    cleaned_asc: Optional[str] = None
    msg_timestamps: Dict[int, List[float]] = {}
    try:
        # 3. Parse and decode
        trace_lower = args.trace.lower()
        if trace_lower.endswith(".asc"):
            cleaned_asc = sanitize_asc(args.trace)
            trace_data, start_time, end_time = parse_asc_trace(cleaned_asc, db, messages, sigs, msg_timestamps)
        elif trace_lower.endswith(".blf"):
            trace_data, start_time, end_time = parse_blf_trace(args.trace, db, messages, sigs, msg_timestamps)
        else:
            print(json.dumps({"image": "", "summary": "", "error": f"Unsupported CAN trace format: {args.trace}"}))
            return

        # 4. 分析报文发送特性
        characteristics = {}
        id_to_msg: Dict[int, Tuple[str, Any]] = {}
        for msg_name, msg in messages.items():
            id_to_msg[msg.frame_id] = (msg_name, msg)

        for arb_id, ts_list in msg_timestamps.items():
            entry = id_to_msg.get(arb_id)
            if entry:
                msg_name, msg = entry
                char_res = analyze_periodicity(ts_list)
                characteristics[msg_name] = {
                    "frame_id": hex(arb_id),
                    "fast_period": char_res["fast_period"],
                    "slow_period": char_res["slow_period"],
                    "fast_frames": char_res["fast_frames"],
                    "msg_type": char_res["msg_type"]
                }

        # 5. Summary
        summary_text = summarize_segments(trace_data)
        missing_text = summarize_missing(signal_names, trace_data)
        if missing_text:
            summary_text = summary_text + "\n" + missing_text if summary_text else missing_text

        # 6. Get ticks
        tick_info = get_ticks(messages, sigs)

        # 7. Plot
        os.makedirs(os.path.dirname(args.output), exist_ok=True)
        trace_basename = os.path.basename(args.trace)
        plotted = plot_signals_chart(trace_data, tick_info, args.output, start_time, trace_basename)

        result = {
            "image": args.output if plotted else "",
            "summary": summary_text,
            "error": "",
            "traceStartTime": format_trace_timestamp(start_time),
            "traceEndTime": format_trace_timestamp(end_time),
            "msg_characteristics": characteristics,
            "trace_data": {
                key: {
                    "x": [dt.strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] if isinstance(dt, datetime.datetime) else dt for dt in val["x"]],
                    "y": val["y"]
                }
                for key, val in trace_data.items()
            },
            "ticks": tick_info,
        }
    finally:
        # Cleanup temp file
        if cleaned_asc:
            try:
                os.remove(cleaned_asc)
            except Exception:
                pass

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
