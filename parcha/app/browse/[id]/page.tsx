import type { Metadata } from "next"
import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"

import { JudgmentReader } from "@/components/browse/judgment-reader"
import { fetchJudgment } from "@/lib/browse/client"
import { getAuth } from "@/lib/auth"

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
  searchParams: Promise<{ page?: string }>
}) {
  const { id } = await params
  const { page } = await searchParams
  const session = await getAuth().api.getSession({ headers: await headers() })
  if (!session) {
    redirect(`/sign-in?callbackURL=/browse/${encodeURIComponent(id)}`)
  }

  const judgment = await fetchJudgment(decodeURIComponent(id))
  if (!judgment) notFound()

  const initialPdfPage = Number.parseInt(page ?? "", 10)

  return (
    <JudgmentReader
      judgment={judgment}
      initialPdfPage={Number.isFinite(initialPdfPage) ? initialPdfPage : null}
    />
  )
}
