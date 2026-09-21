import type { Metadata } from "next"

import { AuthenticatedResearchPage } from "@/components/research/authenticated-research-page"

export const metadata: Metadata = {
  title: "Search — Vidhi Kosh",
  description:
    "Search ranked Indian Supreme Court cases in the Vidhi Kosh index.",
}
export const dynamic = "force-dynamic"

export default function SearchPage() {
  return <AuthenticatedResearchPage mode="search" callbackURL="/search" />
}
