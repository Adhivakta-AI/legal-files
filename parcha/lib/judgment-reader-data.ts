import "server-only"

import {
  buildJudgmentReadingCopy,
  type JudgmentReadingCopy,
  type ReadingCopyChunkRow,
} from "@/lib/reading-copy"
import { cloudflareEnv, serverSetting } from "@/lib/server-env"

export interface JudgmentTopic {
  topic: string
  source_chunk_id: string | null
  provenance: "headnote" | "judgment_text" | "machine_extracted" | "editorial"
  review_status: "unreviewed" | "source_verified" | "lawyer_reviewed"
}

export interface CitedPassage {
  id: string
  pdf_page: number
  paragraph_number: string | null
  text: string
  text_source: string
}

export interface JudgmentReaderData {
  topics: JudgmentTopic[]
  citedPassage: CitedPassage | null
  readingCopy: JudgmentReadingCopy | null
}

const JUDGMENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/
const CHUNK_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,299}$/
const READING_COPY_PROTOTYPES = new Set([
  "ISC-14738EAB816B5B6BAB4C",
  "ISC-3389B4314DCC5735F45B",
])

function readingCopyPrototypeEnabled(): boolean {
  return /^(?:1|true|yes)$/i.test(
    serverSetting("READING_COPY_PROTOTYPE") ?? ""
  )
}

export async function getJudgmentReaderData(
  judgmentId: string,
  chunkId?: string | null
): Promise<JudgmentReaderData> {
  if (!JUDGMENT_ID.test(judgmentId)) {
    return { topics: [], citedPassage: null, readingCopy: null }
  }

  const db = cloudflareEnv().LEGAL_DB
  const topicsQuery = db
    .prepare(
      `SELECT topic, source_chunk_id, provenance, review_status
         FROM judgment_topics
        WHERE judgment_id = ?1
        ORDER BY sort_order, topic`
    )
    .bind(judgmentId)
    .all<JudgmentTopic>()

  const validChunk =
    chunkId && CHUNK_ID.test(chunkId) && chunkId.startsWith(`${judgmentId}:`)
      ? chunkId
      : null
  const passageQuery = validChunk
    ? db
        .prepare(
          `SELECT id, pdf_page, paragraph_number, text, text_source
             FROM chunks
            WHERE id = ?1 AND judgment_id = ?2`
        )
        .bind(validChunk, judgmentId)
        .first<CitedPassage>()
    : Promise.resolve(null)
  const readingCopyQuery =
    readingCopyPrototypeEnabled() && READING_COPY_PROTOTYPES.has(judgmentId)
    ? db
        .prepare(
          `SELECT id, pdf_page, paragraph_index, paragraph_number,
                  part_index, text, text_source
             FROM chunks
            WHERE judgment_id = ?1
            ORDER BY pdf_page, paragraph_index, part_index`
        )
        .bind(judgmentId)
        .all<ReadingCopyChunkRow>()
        .then((result: { results: ReadingCopyChunkRow[] }) => result.results)
    : Promise.resolve([])

  const [topicsResult, citedPassage, readingCopyRows] = await Promise.all([
    topicsQuery,
    passageQuery,
    readingCopyQuery,
  ])
  const readingCopy = readingCopyRows.length
    ? buildJudgmentReadingCopy(judgmentId, readingCopyRows)
    : null

  return {
    topics: topicsResult.results,
    citedPassage,
    readingCopy: readingCopy?.blockCount ? readingCopy : null,
  }
}
