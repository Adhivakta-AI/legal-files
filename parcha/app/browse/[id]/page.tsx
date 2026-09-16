import type { Metadata } from "next"
import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"

import { JudgmentReader } from "@/components/browse/judgment-reader"
import { fetchJudgment } from "@/lib/browse/client"
import { getAuth } from "@/lib/auth"
import { getJudgmentReaderData } from "@/lib/judgment-reader-data"
import { createPdfAccessToken } from "@/lib/pdf-access"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  try {
    const judgment = await fetchJudgment(decodeURIComponent(id))
    if (judgment) {
      return {
        title: `${judgment.title} — Lex Archives`,
        description: judgment.citation
          ? `${judgment.citation} · ${judgment.court}`
          : judgment.court,
      }
    }
  } catch {
    // fall through to the default
  }
  return { title: "Judgment — Lex Archives" }
}

export default async function JudgmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    page?: string
    from?: string
    thread?: string
    chunk?: string
  }>
}) {
  const { id } = await params
  const { page, from, thread, chunk } = await searchParams
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
  const callbackPath = `/browse/${encodeURIComponent(id)}${currentParams.size ? `?${currentParams.toString()}` : ""}`
  const session = await getAuth().api.getSession({ headers: await headers() })
  if (!session) {
    redirect(`/sign-in?callbackURL=${encodeURIComponent(callbackPath)}`)
  }

  const judgmentId = decodeURIComponent(id)
  const [judgment, readerData, pdfAccessToken] = await Promise.all([
    fetchJudgment(judgmentId),
    getJudgmentReaderData(
      judgmentId,
      typeof chunk === "string" ? chunk.slice(0, 300) : null
    ),
    createPdfAccessToken(`judgment:${judgmentId}`),
  ])
  if (!judgment) notFound()

  const initialPdfPage = Number.parseInt(page ?? "", 10)

  return (
    <JudgmentReader
      judgment={judgment}
      initialPdfPage={Number.isFinite(initialPdfPage) ? initialPdfPage : null}
      returnHref={returnHref}
      returnLabel={fromAiPro ? "AI PRO" : "RESULTS"}
      highlightChunkId={typeof chunk === "string" ? chunk.slice(0, 300) : null}
      readerData={readerData}
      pdfAccessToken={pdfAccessToken}
      aiProMode={fromAiPro}
    />
  )
}
