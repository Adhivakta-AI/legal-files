"use client"

import { PdfViewer } from "./pdf-viewer"
import { useResearchStore } from "./store/research-store"

export function PdfModal() {
  const citation = useResearchStore((state) => state.pdfCitation)
  const closePdf = useResearchStore((state) => state.closePdf)

  if (!citation) return null
  return <PdfViewer citation={citation} onClose={closePdf} />
}
