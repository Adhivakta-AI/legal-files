interface JudgmentSource {
  judgment_id: string
  chunk_id: string
}

interface LegalSource {
  chunk_id: string
}

export interface GroundingValidationInput {
  answer: string
  judgmentSources: JudgmentSource[]
  legalSources: LegalSource[]
}

interface DraftSectionCandidate {
  heading?: unknown
  body?: unknown
  source_ids?: unknown
}

export interface GroundedDraftComposition {
  answer: string
  sourceIds: string[]
  droppedSectionCount: number
}

const LEGAL_CLAIM_TERMS =
  /\b(?:act|appl(?:y|ies|icable)|arrest|article|authority|bail|bars?|civil|cognizable|constitutional|conviction|court|criminal|defen[cs]e|elements?|entitled|excludes?|fir|guilty|held|illegal|includes?|investigation|judgment|jurisdiction|liable|limitation|means|must|offence|permits?|precedent|procedure|prohibited|required|requires?|remedy|right|section|shall|statutory|valid|void)\b/i

const INSUFFICIENCY_STATEMENT =
  /\b(?:cannot be (?:established|determined)|do not establish|does not establish|insufficient (?:authority|evidence|information|material|sources|to (?:establish|determine))|not established by the retrieved|not shown in the retrieved)\b/i

export function inlineSourceIds(answer: string): string[] {
  return [...answer.matchAll(/\[\[([^\]]+)\]\]/g)]
    .map((match) => match[1].trim())
    .filter(Boolean)
}

function answerBlocks(answer: string): string[] {
  return answer.split(/\n{2,}/).flatMap((block) => {
    const trimmed = block.trim()
    if (!trimmed) return []
    const lines = trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !/^#{1,6}\s/.test(line))
    if (!lines.length) return []
    const units = lines.every((line) => /^[-*•]\s/.test(line))
      ? lines.map((line) => line.replace(/^[-*•]\s*/, ""))
      : [lines.join(" ")]
    return units.map((unit) => unit.trim()).filter(Boolean)
  })
}

function plainText(segment: string): string {
  return segment
    .replace(/\[\[[^\]]+\]\]/g, "")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function isSubstantiveClaim(segment: string): boolean {
  const plain = plainText(segment)
  if (!plain || INSUFFICIENCY_STATEMENT.test(plain)) return false
  return plain.length >= 48 || LEGAL_CLAIM_TERMS.test(plain)
}

export function substantiveClaimSegments(answer: string): string[] {
  return answerBlocks(answer).filter(isSubstantiveClaim)
}

export function composeGroundedDraft(
  value: unknown,
  allowedSourceIds: ReadonlySet<string>
): GroundedDraftComposition | null {
  if (!Array.isArray(value)) return null

  const blocks: string[] = []
  const usedSourceIds: string[] = []
  let droppedSectionCount = 0

  value.forEach((candidate) => {
    if (typeof candidate !== "object" || candidate === null) {
      droppedSectionCount += 1
      return
    }
    const section = candidate as DraftSectionCandidate
    const body =
      typeof section.body === "string"
        ? section.body
            .replace(/\[\[[^\]]*\]\]/g, "")
            .replace(/\s+/g, " ")
            .trim()
        : ""
    const sourceIds = Array.isArray(section.source_ids)
      ? [
          ...new Set(
            section.source_ids
              .filter((id): id is string => typeof id === "string")
              .map((id) => id.trim())
              .filter((id) => allowedSourceIds.has(id))
          ),
        ].slice(0, 4)
      : []

    if (!body || sourceIds.length === 0) {
      droppedSectionCount += 1
      return
    }

    const heading =
      typeof section.heading === "string"
        ? section.heading
            .replace(/[#\r\n]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 120)
        : ""
    const markers = sourceIds.map((id) => `[[${id}]]`).join(" ")
    blocks.push(`${heading ? `## ${heading}\n\n` : ""}${body} ${markers}`)
    sourceIds.forEach((id) => {
      if (!usedSourceIds.includes(id)) usedSourceIds.push(id)
    })
  })

  if (!blocks.length) return null
  return {
    answer: blocks.join("\n\n"),
    sourceIds: usedSourceIds,
    droppedSectionCount,
  }
}

export function validateGroundedDraft({
  answer,
  judgmentSources,
  legalSources,
}: GroundingValidationInput): string | null {
  const judgmentChunkIds = new Set(
    judgmentSources.map((source) => source.chunk_id)
  )
  const legalChunkIds = new Set(legalSources.map((source) => source.chunk_id))
  const allowedSourceIds = new Set([...judgmentChunkIds, ...legalChunkIds])
  const citedIds = inlineSourceIds(answer)

  if (citedIds.length === 0) {
    return "The answer contained no inline source citations."
  }
  const invalidInline = citedIds.find((id) => !allowedSourceIds.has(id))
  if (invalidInline) {
    return `The answer cited a source_id outside the retrieved allow-list: ${invalidInline}.`
  }

  const unsupportedClaim = substantiveClaimSegments(answer).find(
    (segment) => inlineSourceIds(segment).length === 0
  )
  if (unsupportedClaim) {
    return "At least one substantive legal paragraph or bullet lacked an inline [[source_id]] citation."
  }

  return null
}
