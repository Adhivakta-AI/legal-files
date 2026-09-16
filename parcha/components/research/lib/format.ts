import type { Citation } from "@/lib/research/types"

export function sourceToken(id: string): string {
  return id.length > 13 ? `${id.slice(0, 7)}…${id.slice(-4)}` : id
}

export function citationSourceId(citation: Citation): string {
  return (
    citation.source_id ||
    citation.judgment_id ||
    citation.unit_id ||
    citation.chunk_id ||
    "source"
  )
}

export function citationSourceType(
  citation: Citation
): "judgment" | "legislation" {
  return citation.source_type === "legislation" ? "legislation" : "judgment"
}
