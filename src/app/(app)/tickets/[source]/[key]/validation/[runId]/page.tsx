import { notFound } from "next/navigation";
import { ValidationDetail } from "@/features/tickets/components/validation-detail";
export default async function ValidationPage({ params }: { params: Promise<{ source: string; key: string; runId: string }> }) {
  const { source, key, runId } = await params;
  if (source !== "jira" && source !== "meegle") notFound();
  return <ValidationDetail runId={runId} source={source} ticketKey={key} />;
}
