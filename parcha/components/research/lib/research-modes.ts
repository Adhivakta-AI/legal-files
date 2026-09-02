import type { ResearchMode } from "@/lib/research/types"

export const RESEARCH_MODES: Array<{
  value: ResearchMode
  label: string
  description: string
}> = [
  {
    value: "search",
    label: "Search",
    description: "Ranked cases from the Cloudflare index",
  },
  {
    value: "ai_pro",
    label: "AI Pro",
    description: "Grounded synthesis with verified citations",
  },
]

export const EXAMPLES = [
  "POCSO act cases on consent and age determination",
  "When can a court grant a temporary injunction under CPC?",
  "Leading Supreme Court cases on unlawful eviction without notice",
]
