"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Chart, ScatterController, LinearScale, PointElement, Tooltip, Legend } from "chart.js";
import zoomPlugin from "chartjs-plugin-zoom";
import { Save, RotateCcw } from "lucide-react";
import type { SignalTicks, SignalTraceData } from "@/domain/entities";
import { tracePoints, usableTickConfig } from "@/domain/analysis/can-chart";
import { apiFetch } from "@/shared/lib/api";
import { errorMessage } from "@/shared/lib/errors";
import { useTheme } from "@/shared/layout/theme";
import { Button, Card, CardContent, CardHeader, CardTitle, toast } from "@/shared/ui";

Chart.register(ScatterController, LinearScale, PointElement, Tooltip, Legend, zoomPlugin);
interface Props { artifactKey: string; traceData?: SignalTraceData; ticks?: SignalTicks; chartImagePath?: string; signalSummary?: string }

export function CanSignalChart({ artifactKey, traceData, ticks, chartImagePath, signalSummary }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const charts = useRef<Array<Chart<"scatter">>>([]);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  const { preference } = useTheme();
  const entries = useMemo(() => Object.entries(traceData ?? {}).map(([name, data]) => ({ name, points: tracePoints(data) })).filter((entry) => entry.points.length), [traceData]);

  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    const color = (token: string) => style.getPropertyValue(token).trim();
    const allX = entries.flatMap((entry) => entry.points.map((point) => point.x));
    const extent = allX.reduce((value, x) => ({ min: Math.min(value.min, x), max: Math.max(value.max, x) }), { min: Infinity, max: -Infinity });
    const palette = ["--primary", "--info", "--warning", "--accent-purple"];
    const sync = (source: Chart) => {
      const axis = source.scales.x;
      for (const chart of charts.current) {
        if (chart === source || !chart.options.scales?.x) continue;
        chart.options.scales.x.min = axis.min; chart.options.scales.x.max = axis.max; chart.update("none");
      }
    };
    charts.current = entries.flatMap(({ name, points }, index) => {
      const canvas = root.current?.querySelectorAll("canvas")[index];
      if (!canvas) return [];
      const choices = ticks?.[name];
      const useChoices = usableTickConfig(choices, points.map((point) => point.y));
      return [new Chart<"scatter">(canvas, {
        type: "scatter", data: { datasets: [{ label: name, data: points, pointRadius: 3, backgroundColor: color(palette[index % palette.length]) }] },
        options: { animation: false, responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: color("--foreground") } }, tooltip: { callbacks: { title: (items) => new Date(Number(items[0]?.parsed.x)).toLocaleString("zh-CN", { hour12: false, fractionalSecondDigits: 3 }) } },
            zoom: { zoom: { drag: { enabled: true }, mode: "x", onZoom: ({ chart }) => sync(chart) }, pan: { enabled: true, mode: "x", modifierKey: "ctrl", onPan: ({ chart }) => sync(chart) } } },
          scales: { x: { type: "linear", min: extent.min, max: extent.max, grid: { color: color("--border") }, ticks: { display: index === entries.length - 1, color: color("--muted-foreground"), callback: (value) => new Date(Number(value)).toLocaleTimeString("zh-CN", { hour12: false }) } },
            y: { type: "linear", grid: { color: color("--border") }, min: useChoices ? Math.min(...choices!.ticks) : undefined, max: useChoices ? Math.max(...choices!.ticks) : undefined,
              afterBuildTicks: useChoices ? (axis) => { axis.ticks = choices!.ticks.map((value) => ({ value })); } : undefined,
              ticks: { color: color("--muted-foreground"), callback: (value) => useChoices ? choices!.labels[choices!.ticks.indexOf(Number(value))] ?? value : value } } },
        },
      })];
    });
    return () => { charts.current.forEach((chart) => chart.destroy()); charts.current = []; };
  }, [entries, ticks, preference]);

  async function saveViewport() {
    if (!chartImagePath || !charts.current.length || saving) return;
    setSaving(true);
    try {
      const canvases = charts.current.map((chart) => { chart.update("none"); return chart.canvas; });
      const merged = document.createElement("canvas");
      const width = Math.max(...canvases.map((canvas) => canvas.width));
      merged.width = width + 40; merged.height = canvases.reduce((sum, canvas) => sum + canvas.height + 20, 60);
      const context = merged.getContext("2d");
      if (!context) throw new Error("无法创建截图画布");
      const style = getComputedStyle(document.documentElement);
      context.fillStyle = style.getPropertyValue("--surface").trim(); context.fillRect(0, 0, merged.width, merged.height);
      context.fillStyle = style.getPropertyValue("--foreground").trim(); context.font = "16px sans-serif"; context.fillText(artifactKey, 20, 28);
      let y = 50;
      for (const canvas of canvases) { context.drawImage(canvas, 20, y); y += canvas.height + 20; }
      await apiFetch("/api/issues/save-screenshot", { method: "POST", json: { issueKey: artifactKey, chartImagePath, imageBase64: merged.toDataURL("image/png") } });
      setVersion((value) => value + 1); toast.success("当前视口已保存为回填图");
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setSaving(false); }
  }
  if (!entries.length && !chartImagePath && !signalSummary) return null;
  return <Card>
    <CardHeader><CardTitle>CAN 信号时序图</CardTitle>{entries.length ? <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => charts.current.forEach((chart) => chart.resetZoom())}><RotateCcw aria-hidden />重置缩放</Button><Button variant="outline" size="sm" loading={saving} disabled={!chartImagePath} onClick={() => void saveViewport()}><Save aria-hidden />锁定回填图</Button></div> : null}</CardHeader>
    <CardContent className="space-y-4"><p className="text-xs text-muted-foreground">拖拽框选 X 轴放大；按住 Ctrl 拖动平移。各信号共享时间范围。</p>
      <div ref={root} className="space-y-4">{entries.map(({ name }) => <div key={name} className="h-64 rounded-md border border-border p-2"><canvas aria-label={`${name} 时序图`} role="img" /></div>)}</div>
      {!entries.length && chartImagePath ? <Image unoptimized width={1600} height={900} src={`${chartImagePath}?v=${version}`} alt="CAN 信号时序图" className="h-auto w-full rounded-md" /> : null}
      {signalSummary ? <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{signalSummary}</pre> : null}
    </CardContent>
  </Card>;
}
