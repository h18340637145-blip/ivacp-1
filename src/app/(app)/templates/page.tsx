import type { Metadata } from "next";
import { TemplateLibraryView } from "@/features/templates/components/template-library-view";

export const metadata: Metadata = { title: "模板库" };

export default function TemplatesPage() {
  return <TemplateLibraryView />;
}
