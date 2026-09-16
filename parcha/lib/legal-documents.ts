import "server-only"

import { cloudflareEnv } from "@/lib/server-env"

export interface LegalDocumentRecord {
  id: string
  source_kind: "statute" | "constitution"
  title: string
  short_title: string
  jurisdiction: string
  authority: string
  act_number: string | null
  enacted_on: string | null
  effective_from: string | null
  current_through: string | null
  source_url: string
  canonical_url: string
  source_sha256: string
  corpus_version: string
  pdf_key: string
}

export interface LegalCitedPassage {
  id: string
  text: string
  pdf_page_start: number | null
  unit_kind: string
  unit_number: string
  heading: string
}

const DOCUMENT_ID = /^[a-z0-9][a-z0-9-]{0,79}$/

export async function getLegalDocument(
  documentId: string
): Promise<LegalDocumentRecord | null> {
  if (!DOCUMENT_ID.test(documentId)) return null
  return cloudflareEnv()
    .LEGAL_DB.prepare(
      `SELECT id, source_kind, title, short_title, jurisdiction, authority,
              act_number, enacted_on, effective_from, current_through,
              source_url, canonical_url, source_sha256, corpus_version, pdf_key
         FROM legal_documents
        WHERE id = ?1 AND pdf_key IS NOT NULL`
    )
    .bind(documentId)
    .first<LegalDocumentRecord>()
}

export async function getLegalCitedPassage(
  documentId: string,
  chunkId?: string | null
): Promise<LegalCitedPassage | null> {
  if (!DOCUMENT_ID.test(documentId) || !chunkId || chunkId.length > 300) {
    return null
  }
  return cloudflareEnv()
    .LEGAL_DB.prepare(
      `SELECT id, text, pdf_page_start, unit_kind, unit_number, heading
         FROM legal_chunks
        WHERE id = ?1 AND document_id = ?2`
    )
    .bind(chunkId, documentId)
    .first<LegalCitedPassage>()
}
