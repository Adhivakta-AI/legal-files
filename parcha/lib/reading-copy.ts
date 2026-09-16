export type ReadingCopyBlockKind = "paragraph" | "footnote" | "heading"

/**
 * The fields needed from an ordered D1 `chunks` query.
 *
 * D1 chunks are search windows rather than lossless page text. Long paragraphs
 * are split into overlapping parts and very short fragments may be absent.
 */
export interface ReadingCopyChunkRow {
  id: string
  pdf_page: number
  paragraph_index: number
  paragraph_number: string | null
  part_index: number
  text: string
  text_source?: string | null
}

export interface ReadingCopyBlock {
  id: string
  sourcePage: number
  paragraphNumber: string | null
  kind: ReadingCopyBlockKind
  text: string
  sourceChunkIds: string[]
}

export interface ReadingCopyPage {
  sourcePage: number
  blocks: ReadingCopyBlock[]
}

export interface JudgmentReadingCopy {
  version: 1
  pages: ReadingCopyPage[]
  blockCount: number
  startPage: number | null
  endPage: number | null
  /** Resolves an existing citation chunk ID to the block containing its text. */
  chunkToBlockId: Record<string, string>
}

interface IndexedChunk extends ReadingCopyChunkRow {
  inputIndex: number
}

interface DraftBlock extends ReadingCopyBlock {
  paragraphIndex: number
}

const LEADING_PARAGRAPH_NUMBER =
  /^\s*(?:\[\s*(\d{1,4})\s*\]|(\d{1,4})[.)])(?:\s|$)/
const SCR_NAME = /\bsupreme\s+court\s+reports?\b/i
const SCR_CITATION =
  /(?:\[\s*\d{4}\s*\]|\(\s*\d{4}\s*\)|\b\d{4})\s*(?:\d+\s*)?s\.?\s*c\.?\s*r\.?\s*(?:\d+)?/i
const RESULT_OF_CASE = /^result\s+of\s+(?:the\s+)?case\s*:/i

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function normalizedText(value: string): string {
  return value
    .replace(/\u00ad/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizedParagraphNumber(value: string | null): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function inferredParagraphNumber(text: string): string | null {
  const match = LEADING_PARAGRAPH_NUMBER.exec(text)
  return match?.[1] ?? match?.[2] ?? null
}

function assertChunkRow(row: ReadingCopyChunkRow, index: number): void {
  if (!row.id || typeof row.id !== "string") {
    throw new TypeError(`Reading-copy row ${index} has no chunk ID`)
  }
  if (!Number.isInteger(row.pdf_page) || row.pdf_page < 1) {
    throw new TypeError(`Reading-copy chunk ${row.id} has an invalid PDF page`)
  }
  if (!Number.isInteger(row.paragraph_index) || row.paragraph_index < 1) {
    throw new TypeError(
      `Reading-copy chunk ${row.id} has an invalid paragraph index`
    )
  }
  if (!Number.isInteger(row.part_index) || row.part_index < 1) {
    throw new TypeError(
      `Reading-copy chunk ${row.id} has an invalid part index`
    )
  }
  if (typeof row.text !== "string") {
    throw new TypeError(`Reading-copy chunk ${row.id} has invalid text`)
  }
}

function mergeOverlappingParts(parts: readonly IndexedChunk[]): string {
  const texts = parts.map((part) => normalizedText(part.text)).filter(Boolean)
  if (!texts.length) return ""

  const merged = texts[0].split(" ")
  for (const text of texts.slice(1)) {
    const next = text.split(" ")
    const possibleOverlap = Math.min(merged.length, next.length)
    let overlap = 0

    // OCR chunking currently creates a 30-word overlap. Finding the longest
    // exact suffix/prefix also handles duplicate parts and future window sizes.
    for (let size = possibleOverlap; size >= 2; size -= 1) {
      let matches = true
      const mergedStart = merged.length - size
      for (let offset = 0; offset < size; offset += 1) {
        if (merged[mergedStart + offset] !== next[offset]) {
          matches = false
          break
        }
      }
      if (matches) {
        overlap = size
        break
      }
    }

    merged.push(...next.slice(overlap))
  }
  return merged.join(" ")
}

function looksLikeFootnote(text: string): boolean {
  if (/^(?:\*+|[†‡§]+)\s*/.test(text)) return true
  if (/^footnotes?\s*[:.-]/i.test(text)) return true

  const numbered = /^(?:\[\s*\d{1,3}\s*\]|\d{1,3}[.)]?)\s+(.+)/.exec(text)
  if (!numbered) return false

  const note = numbered[1]
  return (
    /^(?:see(?:\s+also)?|cf\.?|contra|ibid\.?|supra|infra|available\s+at|https?:\/\/|www\.)\b/i.test(
      note
    ) ||
    /^(?:\[\s*\d{4}\s*\]|\(\s*\d{4}\s*\)|\d{4}\s)/.test(note) ||
    (note.length <= 280 &&
      /\b(?:AIR|SCC|SCC\s+OnLine|S\.?\s*C\.?\s*R\.?|All\s+ER|Cri\s+LJ)\b/i.test(
        note
      ))
  )
}

function uppercaseRatio(text: string): number {
  const letters = text.match(/[A-Za-z]/g) ?? []
  if (!letters.length) return 0
  const uppercase = letters.filter((letter) => letter === letter.toUpperCase())
  return uppercase.length / letters.length
}

function looksLikeHeading(
  text: string,
  paragraphNumber: string | null
): boolean {
  if (paragraphNumber !== null) return false

  const withoutPunctuation = text.replace(/[.:\s-]+$/g, "").trim()
  if (
    /^(?:reportable|non-reportable|judg(?:e)?ment|order|coram|held|headnote|appearance(?:s)?|civil\s+(?:original|appellate)\s+jurisdiction|criminal\s+(?:original|appellate)\s+jurisdiction)$/i.test(
      withoutPunctuation
    )
  ) {
    return true
  }

  const wordCount = text.split(" ").length
  if (text.length <= 160 && wordCount <= 18 && uppercaseRatio(text) >= 0.78) {
    return true
  }
  return /^(?:[IVXLCDM]+|[A-Z])[.)]\s+\S/.test(text) && wordCount <= 18
}

function classifyBlock(
  text: string,
  paragraphNumber: string | null
): ReadingCopyBlockKind {
  if (looksLikeFootnote(text)) return "footnote"
  if (looksLikeHeading(text, paragraphNumber)) return "heading"
  return "paragraph"
}

function padded(value: number, width: number): string {
  return String(value).padStart(width, "0")
}

function blockId(
  judgmentId: string,
  sourcePage: number,
  paragraphIndex: number
): string {
  return `${judgmentId}:reading:p${padded(sourcePage, 4)}:para${padded(
    paragraphIndex,
    4
  )}`
}

function isExplicitScrHeader(block: DraftBlock): boolean {
  if (block.paragraphIndex > 3) return false
  if (block.text.length > 260 || block.text.split(" ").length > 36) return false

  if (SCR_NAME.test(block.text)) return true
  return new RegExp(`^(?:\\d{1,4}\\s+)?${SCR_CITATION.source}`, "i").test(
    block.text
  )
}

function isEditorialHeadnoteCredit(block: DraftBlock): boolean {
  return /^(?:[†‡*]\s*)?headnotes?\s+(?:prepared|written|edited)\s+by\b/i.test(
    block.text
  )
}

function headerFingerprint(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(new RegExp(SCR_CITATION.source, "gi"), " ")
    .replace(/\b(?:page\s*)?\d{1,4}\b/g, " ")
    .replace(/[^a-z]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function isRepeatableHeaderCandidate(block: DraftBlock): boolean {
  if (block.paragraphNumber !== null || block.paragraphIndex > 3) return false
  if (block.text.length > 260 || block.text.split(" ").length > 36) return false

  return (
    uppercaseRatio(block.text) >= 0.62 ||
    /\b(?:v(?:s|ersus)?\.?|petitioner|respondent)\b/i.test(block.text) ||
    /\[[^\]]+,\s*J\.?\]/i.test(block.text)
  )
}

function repeatedHeaderFingerprints(
  blocks: readonly DraftBlock[]
): Set<string> {
  const pagesByFingerprint = new Map<string, Set<number>>()
  for (const block of blocks) {
    if (!isRepeatableHeaderCandidate(block)) continue
    const fingerprint = headerFingerprint(block.text)
    if (fingerprint.length < 4) continue
    const pages = pagesByFingerprint.get(fingerprint) ?? new Set<number>()
    pages.add(block.sourcePage)
    pagesByFingerprint.set(fingerprint, pages)
  }

  return new Set(
    [...pagesByFingerprint]
      .filter(([, pages]) => pages.size >= 2)
      .map(([fingerprint]) => fingerprint)
  )
}

function isTrueFirstParagraph(block: DraftBlock): boolean {
  if (block.kind !== "paragraph") return false
  if (!/^0*1$/.test(block.paragraphNumber ?? "")) return false
  const match = LEADING_PARAGRAPH_NUMBER.exec(block.text)
  const leadingNumber = match?.[1] ?? match?.[2]
  return Boolean(leadingNumber && /^0*1$/.test(leadingNumber))
}

function draftBlocks(
  judgmentId: string,
  rows: readonly ReadingCopyChunkRow[]
): DraftBlock[] {
  const sorted: IndexedChunk[] = rows
    .map((row, inputIndex) => {
      assertChunkRow(row, inputIndex)
      return { ...row, inputIndex }
    })
    .sort(
      (left, right) =>
        left.pdf_page - right.pdf_page ||
        left.paragraph_index - right.paragraph_index ||
        left.part_index - right.part_index ||
        compareText(left.id, right.id) ||
        left.inputIndex - right.inputIndex
    )

  const groups = new Map<string, IndexedChunk[]>()
  for (const row of sorted) {
    const key = `${row.pdf_page}:${row.paragraph_index}`
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }

  const blocks: DraftBlock[] = []
  for (const parts of groups.values()) {
    const first = parts[0]
    const text = mergeOverlappingParts(parts)
    if (!text) continue

    const paragraphNumber =
      parts
        .map((part) => normalizedParagraphNumber(part.paragraph_number))
        .find((value): value is string => value !== null) ??
      inferredParagraphNumber(text)
    const sourceChunkIds = [...new Set(parts.map((part) => part.id))]
    blocks.push({
      id: blockId(judgmentId, first.pdf_page, first.paragraph_index),
      sourcePage: first.pdf_page,
      paragraphIndex: first.paragraph_index,
      paragraphNumber,
      kind: classifyBlock(text, paragraphNumber),
      text,
      sourceChunkIds,
    })
  }
  return blocks
}

/**
 * Builds a deterministic, JSON-serializable reading-copy model from D1 chunk
 * rows. It preserves source PDF page boundaries so existing citations remain
 * meaningful; it does not claim to recreate text omitted during chunking.
 */
export function buildJudgmentReadingCopy(
  judgmentId: string,
  rows: readonly ReadingCopyChunkRow[]
): JudgmentReadingCopy {
  const normalizedJudgmentId = judgmentId.trim()
  if (!normalizedJudgmentId) {
    throw new TypeError("A judgment ID is required to build a reading copy")
  }

  const candidates = draftBlocks(normalizedJudgmentId, rows)
  const repeatedHeaders = repeatedHeaderFingerprints(candidates)
  const withoutHeaders = candidates.filter((block) => {
    if (isEditorialHeadnoteCredit(block)) return false
    if (RESULT_OF_CASE.test(block.text)) return false
    if (isExplicitScrHeader(block)) return false
    return !repeatedHeaders.has(headerFingerprint(block.text))
  })

  const firstParagraph = withoutHeaders.findIndex(isTrueFirstParagraph)
  const retained =
    firstParagraph >= 0 ? withoutHeaders.slice(firstParagraph) : withoutHeaders

  const pages: ReadingCopyPage[] = []
  for (const block of retained) {
    const publicBlock: ReadingCopyBlock = {
      id: block.id,
      sourcePage: block.sourcePage,
      paragraphNumber: block.paragraphNumber,
      kind: block.kind,
      text: block.text,
      sourceChunkIds: block.sourceChunkIds,
    }
    const page = pages.at(-1)
    if (page?.sourcePage === block.sourcePage) {
      page.blocks.push(publicBlock)
    } else {
      pages.push({ sourcePage: block.sourcePage, blocks: [publicBlock] })
    }
  }

  const chunkToBlockEntries = pages.flatMap((page) =>
    page.blocks.flatMap((block) =>
      block.sourceChunkIds.map((chunkId) => [chunkId, block.id] as const)
    )
  )

  return {
    version: 1,
    pages,
    blockCount: pages.reduce((count, page) => count + page.blocks.length, 0),
    startPage: pages[0]?.sourcePage ?? null,
    endPage: pages.at(-1)?.sourcePage ?? null,
    chunkToBlockId: Object.fromEntries(chunkToBlockEntries),
  }
}
