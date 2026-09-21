import type { Metadata } from "next"

import { AuthenticatedResearchPage } from "@/components/research/authenticated-research-page"

export const metadata: Metadata = {
  title: "AI Pro — Vidhi Kosh",
  description:
    "Citation-grounded legal synthesis across the Vidhi Kosh judgment index.",
}
export const dynamic = "force-dynamic"

export default function AiProPage() {
  return <AuthenticatedResearchPage mode="ai_pro" callbackURL="/ai-pro" />
}
