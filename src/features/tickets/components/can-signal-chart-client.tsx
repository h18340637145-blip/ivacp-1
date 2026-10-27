"use client";
import dynamic from "next/dynamic";
import { Spinner } from "@/shared/ui";
export const CanSignalChart = dynamic(() => import("./can-signal-chart").then((module) => module.CanSignalChart), { ssr: false, loading: () => <Spinner label="正在加载 CAN 时序图" /> });
