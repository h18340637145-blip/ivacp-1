import type { Metadata } from "next";
import { StatisticsView } from "@/features/statistics/components/statistics-view";

export const metadata: Metadata = { title: "统计报表" };

export default function StatisticsPage() {
  return <StatisticsView />;
}
