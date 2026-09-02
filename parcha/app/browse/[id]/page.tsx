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
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await getAuth().api.getSession({ headers: await headers() })
  if (!session) {
    redirect(`/sign-in?callbackURL=/browse/${encodeURIComponent(id)}`)
  }

  const judgment = await fetchJudgment(decodeURIComponent(id))
  if (!judgment) notFound()

  return <JudgmentReader judgment={judgment} />
}
