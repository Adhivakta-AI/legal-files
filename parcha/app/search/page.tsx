import type { Metadata } from "next"

import { AuthenticatedResearchPage } from "@/components/research/authenticated-research-page"

export const metadata: Metadata = {
  title: "Search — Lex Archives",
  description:
    "Search ranked Indian Supreme Court cases in the Lex Archives index.",
}
export const dynamic = "force-dynamic"

export default function SearchPage() {
  return <AuthenticatedResearchPage mode="search" callbackURL="/search" />
}
