import type { Metadata } from "next"
import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"

import { LegalDocumentReader } from "@/components/browse/legal-document-reader"
import { getAuth } from "@/lib/auth"
import { getLegalCitedPassage, getLegalDocument } from "@/lib/legal-documents"
import { createPdfAccessToken } from "@/lib/pdf-access"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ documentId: string }>
}): Promise<Metadata> {
  const { documentId } = await params
  const document = await getLegalDocument(documentId)
  return document
    ? {
        title: `${document.short_title} — Lex Archives`,
        description: `${document.title} · ${document.authority}`,
      }
    : { title: "Primary law — Lex Archives" }
}

export default async function LegalDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ documentId: string }>
  searchParams: Promise<{
    page?: string
    from?: string
    thread?: string
    chunk?: string
    unit?: string
  }>
}) {
  const { documentId } = await params
  const { page, from, thread, chunk, unit } = await searchParams
  const fromAiPro = from === "ai-pro"
  const validThread =
    typeof thread === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      thread
    )
      ? thread
      : null
  const returnHref = fromAiPro
    ? validThread
      ? `/ai-pro?thread=${encodeURIComponent(validThread)}`
      : "/ai-pro"
    : "/browse"
  const currentParams = new URLSearchParams()
  if (page) currentParams.set("page", page)
  if (fromAiPro) currentParams.set("from", "ai-pro")
  if (validThread) currentParams.set("thread", validThread)
  if (chunk) currentParams.set("chunk", chunk.slice(0, 300))
  if (unit) currentParams.set("unit", unit.slice(0, 160))
  const callbackPath = `/legal/${encodeURIComponent(documentId)}${currentParams.size ? `?${currentParams.toString()}` : ""}`
  const session = await getAuth().api.getSession({ headers: await headers() })
  if (!session) {
    redirect(`/sign-in?callbackURL=${encodeURIComponent(callbackPath)}`)
  }

  const [document, citedPassage, pdfAccessToken] = await Promise.all([
    getLegalDocument(documentId),
    getLegalCitedPassage(
      documentId,
      typeof chunk === "string" ? chunk.slice(0, 300) : null
    ),
    createPdfAccessToken(`legal-document:${documentId}`),
  ])
  if (!document) notFound()
  const initialPdfPage = Number.parseInt(page ?? "", 10)

  return (
    <LegalDocumentReader
      document={document}
      initialPdfPage={Number.isFinite(initialPdfPage) ? initialPdfPage : null}
      returnHref={returnHref}
      returnLabel={fromAiPro ? "AI PRO" : "BROWSE"}
      highlightChunkId={typeof chunk === "string" ? chunk.slice(0, 300) : null}
      unitLabel={typeof unit === "string" ? unit.slice(0, 160) : null}
      citedPassage={citedPassage}
      pdfAccessToken={pdfAccessToken}
    />
  )
}
