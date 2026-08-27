import type { Metadata } from "next"

import { ResearchWorkspace } from "@/components/research/research-workspace"

export const metadata: Metadata = {
  title: "Research — Lex Archives",
  description:
    "Citation-grounded Indian Supreme Court research across the Lex Archives judgment index.",
}

export default function ResearchPage() {
  return <ResearchWorkspace />
}
