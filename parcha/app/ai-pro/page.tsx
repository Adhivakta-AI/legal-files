import type { Metadata } from "next"

import { AuthenticatedResearchPage } from "@/components/research/authenticated-research-page"

export const metadata: Metadata = {
  title: "AI Pro — Lex Archives",
  description:
    "Citation-grounded legal synthesis across the Lex Archives judgment index.",
}
export const dynamic = "force-dynamic"

export default function AiProPage() {
  return <AuthenticatedResearchPage mode="ai_pro" callbackURL="/ai-pro" />
}
