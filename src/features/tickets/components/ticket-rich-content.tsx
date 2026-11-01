"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { meegleContextImageUrl, type MeegleContextView } from "@/domain/meegle/context-view";
import type { MeegleWorkItemIdentity } from "@/domain/meegle/work-item-detail";

interface RichContentProps {
  body: string;
  identity?: MeegleWorkItemIdentity;
  images?: MeegleContextView["images"];
}

export function TicketCachedImage({ originalUrl, alt, identity, images }: Omit<RichContentProps, "body"> & { originalUrl: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  const image = images?.[originalUrl];
  if (!identity || image?.status !== "cached" || failed) {
    return <span role="img" aria-label={alt || "评论图片"} className="my-2 inline-flex max-w-full items-center gap-2 rounded-md border border-dashed border-border bg-surface-2 px-3 py-3 text-xs text-muted-foreground">图片暂不可用{alt ? ` · ${alt}` : ""}{image?.reason ? `（${image.reason}）` : ""}</span>;
  }
  const url = meegleContextImageUrl(identity, image.id);
  // Authenticated local images must bypass the Next.js image optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  return <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`打开大图：${alt || image.name}`} className="my-2 inline-block max-w-full rounded-md border border-border p-1 focus-visible:outline-2 focus-visible:outline-ring"><img src={url} alt={alt || image.name} loading="lazy" onError={() => setFailed(true)} className="max-h-[28rem] max-w-full rounded object-contain" /></a>;
}

export function TicketRichContent({ body, identity, images }: RichContentProps) {
  return <div className="min-w-0 break-words text-sm leading-relaxed [&_p]:my-2 [&_p]:whitespace-pre-wrap [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-border-strong [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_pre]:my-3 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-surface-2 [&_pre]:p-3 [&_code]:break-words [&_code]:font-mono [&_code]:text-xs [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:p-2 [&_h1]:text-lg [&_h2]:text-base [&_h3]:font-semibold">
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={{
      img: ({ src, alt }) => <TicketCachedImage key={`${String(src)}:${images?.[String(src)]?.id ?? ""}`} originalUrl={typeof src === "string" ? src : ""} alt={alt ?? ""} identity={identity} images={images} />,
      a: ({ href, children }) => href && /^(https?:\/\/|mailto:)/i.test(href) ? <a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-primary underline underline-offset-2">{children}</a> : <span>{children}</span>,
    }}>{body || "—"}</ReactMarkdown>
  </div>;
}
