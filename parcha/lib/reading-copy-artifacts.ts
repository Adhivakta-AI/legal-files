import "server-only"

import { cloudflareEnv } from "@/lib/server-env"

/**
 * Artifacts produced by scripts/batch/run.mjs and stored in the DOCUMENTS
 * bucket. The reading copy is an unofficial editorial reproduction; the
 * preserved source PDF under `judgments/<id>/source.pdf` remains authoritative.
 */
export const READING_COPY_VARIANT = "reading-copy"

export function readingCopyKey(judgmentId: string): string {
  return `reading-copies/${judgmentId}/reading-copy.pdf`
}

export function readingCopyLayoutKey(judgmentId: string): string {
  return `reading-copies/${judgmentId}/layout.json.gz`
}

/**
 * Only ~90.8% of the corpus has a reading copy — the rest failed the pipeline's
 * fail-closed gates (OCR paragraph-numbering gaps, unplaceable case-law tables).
 * Callers use this to decide whether to offer the reading-copy view at all,
 * rather than rendering a control that 404s.
 */
export async function hasReadingCopy(judgmentId: string): Promise<boolean> {
  try {
    const object = await cloudflareEnv().DOCUMENTS.head(
      readingCopyKey(judgmentId)
    )
    return Boolean(object)
  } catch {
    return false
  }
}
