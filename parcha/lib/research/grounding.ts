import "server-only"

import { GeminiRequestError, streamJson } from "./gemini"
import type {
  Citation,
  JudgmentContext,
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
          chunk_id: { type: "string" },
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
          "chunk_id",
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
- For every cited judgment, explain specifically why it is relevant to the user's resolved query. Identify the proposition, factual analogy, distinction, or procedural principle supported by its indexed text.
- Each citations entry must name the exact supporting chunk_id that best supports its relevance_note. Use only a supplied chunk_id belonging to that judgment.
- If the excerpts are insufficient, say exactly what cannot be established and set confidence to low. Never fill gaps from memory.
- The citations array must contain one entry for every judgment_id used inline. Metadata will be verified by the server.
- Write for an Indian legal professional: direct, structured, careful, and useful. This is research assistance, not a substitute for advice from counsel.

Return only the requested JSON object.`

interface UntrustedCitation {
  judgment_id?: unknown
  chunk_id?: unknown
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

function judgmentContextBlock(contexts: JudgmentContext[]): string {
  if (!contexts.length) return "No additional indexed judgment text was available."
  return contexts
    .map((context) => {
      const header = JSON.stringify({
        judgment_id: context.judgment_id,
        indexed_text_complete: !context.truncated,
        included_characters: context.included_characters,
      })
      const text = context.chunks
        .map(
          (chunk) =>
            `[CHUNK ${chunk.chunk_id} · PDF PAGE ${chunk.pdf_page} · PARA ${chunk.paragraph_number ?? "—"}]\n${chunk.chunk_text}`
        )
        .join("\n\n")
      return `${header}\n${text}`
    })
    .join("\n\n=== NEXT JUDGMENT ===\n\n")
}

function buildPrompt({
  query,
  mode,
  analysis,
  chunks,
  judgmentContexts,
  correction,
}: {
  query: string
  mode: ResearchMode
  analysis: QueryAnalysis
  chunks: SearchChunk[]
  judgmentContexts: JudgmentContext[]
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
  )}\n\nPRIMARY RETRIEVED PASSAGES:\n${sourceBlock(chunks)}\n\nINDEXED JUDGMENT TEXT:\n${judgmentContextBlock(judgmentContexts)}${
    correction ? `\n\nRETRY INSTRUCTION:\n${correction}` : ""
  }`
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

function groundAnswer(
  raw: UntrustedAnswer,
  chunks: SearchChunk[],
  judgmentContexts: JudgmentContext[]
): ResearchAnswer {
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
  const sourceByChunk = new Map<string, SearchChunk>()
  ;[...chunks, ...judgmentContexts.flatMap((context) => context.chunks)].forEach((chunk) => {
    if (!sourceByChunk.has(chunk.chunk_id)) sourceByChunk.set(chunk.chunk_id, chunk)
  })
  const notes = new Map<string, string>()
  const supportingChunks = new Map<string, string>()
  citationsFrom(raw.citations).forEach((citation) => {
    if (typeof citation.judgment_id !== "string") return
    if (typeof citation.relevance_note !== "string") return
    notes.set(citation.judgment_id, citation.relevance_note.trim().slice(0, 260))
    if (typeof citation.chunk_id === "string") {
      supportingChunks.set(citation.judgment_id, citation.chunk_id)
    }
  })

  const citations: Citation[] = [...new Set(inlineIds(answer))].map((id) => {
    const primarySource = sourceByJudgment.get(id)
    if (!primarySource) throw new Error(`Citation ${id} is not present in the retrieved sources`)
    const requestedSource = sourceByChunk.get(supportingChunks.get(id) ?? "")
    const source = requestedSource?.judgment_id === id ? requestedSource : primarySource
    return {
      judgment_id: source.judgment_id,
      case_name: source.title,
      citation: source.citation ?? "Unreported",
      court: "Supreme Court of India",
      ...(source.paragraph_number ? { paragraph_number: source.paragraph_number } : {}),
      pdf_url: source.pdf_url,
      pdf_page: source.pdf_page,
      relevance_note: notes.get(id) || "Retrieved passage supporting the cited proposition.",
      chunk_id: source.chunk_id,
      excerpt: source.chunk_text.trim().slice(0, 2400),
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
  judgmentContexts,
  correction,
  signal,
}: {
  query: string
  mode: ResearchMode
  analysis: QueryAnalysis
  chunks: SearchChunk[]
  judgmentContexts: JudgmentContext[]
  correction?: string
  signal?: AbortSignal
}): Promise<ResearchAnswer> {
  let json = ""

  for await (const fragment of streamJson({
    systemInstruction: GENERATION_SYSTEM_PROMPT,
    prompt: buildPrompt({ query, mode, analysis, chunks, judgmentContexts, correction }),
    schema: ANSWER_SCHEMA,
    signal,
  })) {
    json += fragment
  }

  return groundAnswer(JSON.parse(json) as UntrustedAnswer, chunks, judgmentContexts)
}

function citationSafeFallback(chunks: SearchChunk[]): ResearchAnswer {
  const sources = [...new Map(chunks.map((chunk) => [chunk.judgment_id, chunk])).values()].slice(0, 5)
  const answer = [
    "The generated synthesis did not pass the archive's citation check. The retrieved authorities below are provided for direct review without inferring any additional holding.",
    sources
      .map(
      (source) =>
        `- **${source.title}**${source.citation ? ` (${source.citation})` : ""} — Review the retrieved passage and linked judgment PDF for its application to this query. [[${source.judgment_id}]]`
      )
      .join("\n"),
  ].join("\n\n")

  return {
    answer,
    citations: sources.map((source) => ({
      judgment_id: source.judgment_id,
      case_name: source.title,
      citation: source.citation ?? "Unreported",
      court: "Supreme Court of India",
      ...(source.paragraph_number ? { paragraph_number: source.paragraph_number } : {}),
      pdf_url: source.pdf_url,
      pdf_page: source.pdf_page,
      relevance_note: "Retrieved authority requiring direct review after synthesis validation failed.",
      chunk_id: source.chunk_id,
      excerpt: source.chunk_text.trim().slice(0, 2400),
    })),
    statutes_referenced: [],
    confidence: "low",
  }
}

export async function generateGroundedAnswer({
  query,
  mode,
  analysis,
  chunks,
  judgmentContexts,
  signal,
  onRetry,
}: {
  query: string
  mode: ResearchMode
  analysis: QueryAnalysis
  chunks: SearchChunk[]
  judgmentContexts: JudgmentContext[]
  signal?: AbortSignal
  onRetry: (reason: string) => void
}): Promise<ResearchAnswer> {
  let correction: string | undefined

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await generateAttempt({
        query,
        mode,
        analysis,
        chunks,
        judgmentContexts,
        correction,
        signal,
      })
    } catch (error) {
      if (error instanceof GeminiRequestError || (error instanceof DOMException && error.name === "AbortError")) {
        throw error
      }
      const reason = error instanceof Error ? error.message : "Grounding validation failed"
      if (attempt === 2) return citationSafeFallback(chunks)
      onRetry(reason)
      correction = `${reason} Start a new draft. Before returning JSON, inspect every paragraph and every bullet of 90 or more characters and place at least one allowed [[judgment_id]] marker inside that same block. Do not leave introductory summaries or conclusions uncited when they contain a legal proposition.`
    }
  }

  return citationSafeFallback(chunks)
}
