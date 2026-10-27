import { redirect } from "next/navigation";
export default async function LegacyResultPage({ params, searchParams }: { params: Promise<{ source: string; key: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { source, key } = await params;
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(await searchParams)) if (typeof value === "string") query.set(name, value);
  redirect(`/tickets/${encodeURIComponent(source)}/${encodeURIComponent(key)}?${query}`);
}
