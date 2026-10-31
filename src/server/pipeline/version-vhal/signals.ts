import path from "node:path";
import type { SignalCheck } from "@/domain/analysis/version-vhal";
export interface SignalRow {
    sheet: string;
    row: number;
    project: string;
    propertyId?: string;
    up: string;
    down: string;
    projectUnknown?: boolean;
}
export function modelFromDbc(file: string): string | undefined {
    const name = path.basename(file);
    const match = /^car_([A-Za-z0-9_]+)\.dbc$/.exec(name);
    return match?.[1].replace(/_(?:Body|IC2)$/, "");
}
function projectModels(row: SignalRow): string[] | undefined {
    const parts = row.project.split("/").map(s => s.trim());
    if (row.projectUnknown || parts.some(s => !s || /^(ALL)$/i.test(s) || !/^[A-Za-z0-9_]+$/.test(s)))
        return;
    return parts;
}
function cellSignals(value: string): string[] {
    return value.trim().replace(/^\[([\s\S]*)\]$/, "$1").split(/[,\r\n]+/).map(v => v.trim()).filter(Boolean);
}
function rowCells(row: SignalRow): Array<[string, string]> {
    return [["Vehicle property ID", row.propertyId ?? ""], ["MCU UP", row.up], ["IVI DOWN", row.down]];
}
export function checkSignalRows(tokens: string[], model: string, rows: SignalRow[]) {
    const signals: SignalCheck[] = [...new Set(tokens.map(t => t.trim()).filter(Boolean))].map(signal => {
        const hits: SignalCheck["hits"] = [], caseCandidates: SignalCheck["hits"] = [];
        for (const row of rows)
            for (const [column, value] of rowCells(row)) {
                const v = value.trim();
                const hit = { sheet: row.sheet, row: row.row, column, value: v, project: row.project };
                const values = cellSignals(v);
                if (values.includes(signal))
                    hits.push(hit);
                else if (values.some(value => value.toLowerCase() === signal.toLowerCase()))
                    caseCandidates.push(hit);
            }
        const matchingRows = rows.filter(row => rowCells(row).some(([, value]) => cellSignals(value).includes(signal)));
        const configured = matchingRows.some(row => projectModels(row)?.includes(model));
        const uncertain = matchingRows.some(row => !projectModels(row));
        return { signal, hits, caseCandidates, caseMismatch: !hits.length && Boolean(caseCandidates.length), status: configured ? "configured" : uncertain ? "unknown" : hits.length ? "model_not_configured" : "signal_missing" };
    });
    return { signals, stop: signals.length > 0 && signals.every(s => !s.caseMismatch && (s.status === "signal_missing" || s.status === "model_not_configured")) };
}
