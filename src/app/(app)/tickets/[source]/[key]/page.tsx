import { Suspense } from "react";
import { notFound } from "next/navigation";
import { TicketDetail } from "@/features/tickets/components/ticket-detail";
import { Spinner } from "@/shared/ui";
export default async function TicketPage({ params }: { params: Promise<{ source: string; key: string }> }) {
  const { source, key } = await params;
  if (source !== "jira" && source !== "meegle") notFound();
  return <Suspense fallback={<Spinner />}><TicketDetail source={source} ticketKey={key} /></Suspense>;
}
