import { Suspense } from "react";
import { RuleGroupAnalysis } from "@/features/workflow/components/rule-group-analysis";
import { Spinner } from "@/shared/ui";

export default async function RuleGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense fallback={<Spinner />}><RuleGroupAnalysis id={id} /></Suspense>;
}
