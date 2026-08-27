import "server-only"

import { GeminiRequestError, streamJson } from "./gemini"
import type {
  Citation,
  QueryAnalysis,
  ResearchAnswer,
  ResearchMode,
  SearchChunk,
} from "./types"

const ANSWER_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    citations: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          judgment_id: { type: "string" },
          case_name: { type: "string" },
          citation: { type: "string" },
          court: { type: "string" },
          paragraph_number: { type: "string" },
          pdf_url: { type: "string" },
          pdf_page: { type: "integer" },
          relevance_note: { type: "string" },
        },
        required: [
          "judgment_id",
          "case_name",
          "citation",
          "court",
          "pdf_url",
          "pdf_page",
          "relevance_note",
        ],
      },
    },
    statutes_referenced: {
      type: "array",
      maxItems: 12,
      items: { type: "string" },
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["answer", "citations", "statutes_referenced", "confidence"],
}

const GENERATION_SYSTEM_PROMPT = `You are Lex Archives, a precise Indian case-law research assistant working only from retrieved Supreme Court judgment excerpts.

Hard grounding rules:
- The supplied sources are your entire legal authority. Do not use remembered case names, citations, holdings, paragraph numbers, or URLs.
- Every substantive paragraph or bullet containing a legal claim must include at least one inline marker in the exact form [[judgment_id]].
- Use only judgment_id values present in the supplied source allow-list.
- Do not claim that a source establishes more than its excerpt supports. Distinguish holdings from observations and factual background.
- If the excerpts are insufficient, say exactly what cannot be established and set confidence to low. Never fill gaps from memory.
- The citations array must contain one entry for every judgment_id used inline. Metadata will be verified by the server.
- Write for an Indian legal professional: direct, structured, careful, and useful. This is research assistance, not a substitute for advice from counsel.

Return only the requested JSON object.`

interface UntrustedCitation {
  judgment_id?: unknown
  relevance_note?: unknown
}

interface UntrustedAnswer {
  answer?: unknown
  citations?: unknown
  statutes_referenced?: unknown
  confidence?: unknown
}

function sourceBlock(chunks: SearchChunk[]): string {
  return chunks
    .map((chunk, index) => {
      const metadata = {
        source: index + 1,
        judgment_id: chunk.judgment_id,
        chunk_id: chunk.chunk_id,
        title: chunk.title,
        citation: chunk.citation,
        decision_date: chunk.decision_date,
        judge: chunk.judge,
        paragraph_number: chunk.paragraph_number,
        pdf_url: chunk.pdf_url,
        pdf_page: chunk.pdf_page,
      }
      return `${JSON.stringify(metadata)}\nEXCERPT:\n${chunk.chunk_text.slice(0, 3600)}`
    })
    .join("\n\n--- NEXT SOURCE ---\n\n")
}

function buildPrompt({
  query,
  mode,
  analysis,
  chunks,
  correction,
}: {
  query: string
  mode: ResearchMode
  analysis: QueryAnalysis
  chunks: SearchChunk[]
  correction?: string
}): string {
  return `USER QUERY:\n${query}\n\nREQUESTED MODE:\n${mode}\n\nQUERY ANALYSIS:\n${JSON.stringify(
    {
      corrected_query: analysis.corrected_query,
      intent: analysis.intent,
      legal_context: analysis.legal_context,
      statutes: analysis.statutes,
    },
    null,
    2
  )}\n\nALLOWED JUDGMENT IDS:\n${[...new Set(chunks.map((chunk) => chunk.judgment_id))].join(
    "\n"
  )}\n\nRETRIEVED SOURCES:\n${sourceBlock(chunks)}${
    correction ? `\n\nRETRY INSTRUCTION:\n${correction}` : ""
  }`
}

function extractPartialStringField(json: string, field: string): string {
  const keyIndex = json.indexOf(`"${field}"`)
  if (keyIndex < 0) return ""
  const colon = json.indexOf(":", keyIndex + field.length + 2)
  if (colon < 0) return ""
  let index = colon + 1
  while (/\s/.test(json[index] ?? "")) index += 1
  if (json[index] !== '"') return ""
  index += 1

  let output = ""
  while (index < json.length) {
    const character = json[index]
    if (character === '"') return output
    if (character !== "\\") {
      output += character
      index += 1
      continue
    }

    const escaped = json[index + 1]
    if (!escaped) break
    const escapes: Record<string, string> = {
      '"': '"',
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    }
    if (escaped === "u") {
      const code = json.slice(index + 2, index + 6)
      if (code.length < 4 || !/^[0-9a-f]{4}$/i.test(code)) break
      output += String.fromCharCode(Number.parseInt(code, 16))
      index += 6
      continue
    }
    output += escapes[escaped] ?? escaped
    index += 2
  }
  return output
}

function inlineIds(answer: string): string[] {
  return [...answer.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1])
}

function validateGrounding(answer: string, chunks: SearchChunk[]): string | null {
  const allowed = new Set(chunks.map((chunk) => chunk.judgment_id))
  const cited = inlineIds(answer)
  if (cited.length === 0) return "The answer contained no inline judgment citations."
  const invalid = cited.find((id) => !allowed.has(id))
  if (invalid) return `The answer cited a judgment_id outside the retrieved allow-list: ${invalid}.`

  const substantiveBlocks = answer
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.replace(/[#*_>-]/g, "").trim().length >= 90)
  const unsupported = substantiveBlocks.find((block) => inlineIds(block).length === 0)
  if (unsupported) {
    return "At least one substantive paragraph lacked an inline [[judgment_id]] citation."
  }
  return null
}

function citationsFrom(value: unknown): UntrustedCitation[] {
  return Array.isArray(value)
    ? value.filter((item): item is UntrustedCitation => typeof item === "object" && item !== null)
    : []
}

function groundAnswer(raw: UntrustedAnswer, chunks: SearchChunk[]): ResearchAnswer {
  if (typeof raw.answer !== "string" || !raw.answer.trim()) {
    throw new Error("Gemini returned an empty answer")
  }
  const answer = raw.answer.trim()
  const validationError = validateGrounding(answer, chunks)
  if (validationError) throw new Error(validationError)

  const sourceByJudgment = new Map<string, SearchChunk>()
  chunks.forEach((chunk) => {
    if (!sourceByJudgment.has(chunk.judgment_id)) sourceByJudgment.set(chunk.judgment_id, chunk)
  })
  const notes = new Map<string, string>()
  citationsFrom(raw.citations).forEach((citation) => {
    if (typeof citation.judgment_id !== "string") return
    if (typeof citation.relevance_note !== "string") return
    notes.set(citation.judgment_id, citation.relevance_note.trim().slice(0, 260))
  })

  const citations: Citation[] = [...new Set(inlineIds(answer))].map((id) => {
    const source = sourceByJudgment.get(id)
    if (!source) throw new Error(`Citation ${id} is not present in the retrieved sources`)
    return {
      judgment_id: source.judgment_id,
      case_name: source.title,
      citation: source.citation ?? "Unreported",
      court: "Supreme Court of India",
      ...(source.paragraph_number ? { paragraph_number: source.paragraph_number } : {}),
      pdf_url: source.pdf_url,
      pdf_page: source.pdf_page,
      relevance_note: notes.get(id) || "Retrieved passage supporting the cited proposition.",
    }
  })

  const statutes = Array.isArray(raw.statutes_referenced)
    ? raw.statutes_referenced
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 12)
    : []

  return {
    answer,
    citations,
    statutes_referenced: [...new Set(statutes)],
    confidence:
      raw.confidence === "high" || raw.confidence === "medium" || raw.confidence === "low"
        ? raw.confidence
        : "low",
  }
}

async function generateAttempt({
  query,
  mode,
  analysis,
  chunks,
  correction,
  signal,
  onDelta,
}: {
  query: string
  mode: ResearchMode
  analysis: QueryAnalysis
  chunks: SearchChunk[]
  correction?: string
  signal?: AbortSignal
  onDelta: (delta: string) => void
}): Promise<ResearchAnswer> {
  let json = ""
  let streamedAnswer = ""

  for await (const fragment of streamJson({
    systemInstruction: GENERATION_SYSTEM_PROMPT,
    prompt: buildPrompt({ query, mode, analysis, chunks, correction }),
    schema: ANSWER_SCHEMA,
    signal,
  })) {
    json += fragment
    const partialAnswer = extractPartialStringField(json, "answer")
    if (partialAnswer.length > streamedAnswer.length) {
      onDelta(partialAnswer.slice(streamedAnswer.length))
      streamedAnswer = partialAnswer
    }
  }

  return groundAnswer(JSON.parse(json) as UntrustedAnswer, chunks)
}

export async function generateGroundedAnswer({
  query,
  mode,
  analysis,
  chunks,
  signal,
  onDelta,
  onRetry,
}: {
  query: string
  mode: ResearchMode
  analysis: QueryAnalysis
  chunks: SearchChunk[]
  signal?: AbortSignal
  onDelta: (delta: string) => void
  onRetry: (reason: string) => void
}): Promise<ResearchAnswer> {
  try {
    return await generateAttempt({ query, mode, analysis, chunks, signal, onDelta })
  } catch (error) {
    if (error instanceof GeminiRequestError || (error instanceof DOMException && error.name === "AbortError")) {
      throw error
    }
    const reason = error instanceof Error ? error.message : "Grounding validation failed"
    onRetry(reason)
    return generateAttempt({
      query,
      mode,
      analysis,
      chunks,
      correction: `${reason} Regenerate from scratch. Cite every substantive paragraph and use only allowed judgment IDs.`,
      signal,
      onDelta,
    })
  }
}
