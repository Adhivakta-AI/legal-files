import { analyzeQuery } from "@/lib/research/analyzer"
import { getAuth } from "@/lib/auth"
import { generateGroundedAnswer } from "@/lib/research/grounding"
import { retrieveChunks, retrieveJudgmentContexts } from "@/lib/research/search"
import type {
  JudgmentContext,
  PipelineStage,
  ResearchConversationContext,
  ResearchMode,
  ResearchRequest,
  ResearchResult,
  ResearchStreamEvent,
} from "@/lib/research/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

const HEADERS = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-content-type-options": "nosniff",
}

function normalizedConversation(value: unknown): ResearchConversationContext | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const context = value as Partial<ResearchConversationContext>
  if (
    typeof context.previous_query !== "string" ||
    typeof context.previous_resolved_query !== "string"
  ) {
    return undefined
  }
  const previousQuery = context.previous_query.trim().slice(0, 3000)
  const previousResolvedQuery = context.previous_resolved_query.trim().slice(0, 500)
  if (!previousQuery || !previousResolvedQuery) return undefined
  const previousLegalContext = Array.isArray(context.previous_legal_context)
    ? context.previous_legal_context
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 160))
        .filter(Boolean)
        .slice(0, 8)
    : []
  const previousCitations = Array.isArray(context.previous_citations)
    ? context.previous_citations
        .filter(
          (item) =>
            typeof item === "object" &&
            item !== null &&
            typeof item.judgment_id === "string" &&
            typeof item.case_name === "string" &&
            typeof item.citation === "string"
        )
        .map((item) => ({
          judgment_id: item.judgment_id.slice(0, 160),
          case_name: item.case_name.slice(0, 240),
          citation: item.citation.slice(0, 160),
        }))
        .slice(0, 8)
    : []
  return {
    previous_query: previousQuery,
    previous_resolved_query: previousResolvedQuery,
    previous_legal_context: previousLegalContext,
    previous_citations: previousCitations,
  }
}

function normalizedRequest(value: unknown): ResearchRequest {
  if (typeof value !== "object" || value === null) throw new Error("Request body must be an object")
  const body = value as Partial<ResearchRequest>
  if (typeof body.query !== "string") throw new Error("query must be a string")
  const query = body.query.trim().replace(/\s+/g, " ")
  if (query.length < 3 || query.length > 3000) {
    throw new Error("query must be between 3 and 3000 characters")
  }
  const modes: ResearchMode[] = ["research", "explain", "draft"]
  const mode = modes.includes(body.mode as ResearchMode) ? (body.mode as ResearchMode) : "research"

  const year = (candidate: unknown, name: string) => {
    if (candidate === undefined) return undefined
    if (
      typeof candidate !== "number" ||
      !Number.isInteger(candidate) ||
      candidate < 1800 ||
      candidate > 2200
    ) {
      throw new Error(`${name} must be an integer between 1800 and 2200`)
    }
    return candidate
  }
  const yearFrom = year(body.year_from, "year_from")
  const yearTo = year(body.year_to, "year_to")
  if (yearFrom && yearTo && yearFrom > yearTo) {
    throw new Error("year_from must be less than or equal to year_to")
  }
  const conversation = normalizedConversation(body.conversation)
  return {
    query,
    mode,
    ...(yearFrom ? { year_from: yearFrom } : {}),
    ...(yearTo ? { year_to: yearTo } : {}),
    ...(conversation ? { conversation } : {}),
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID()
  const session = await getAuth().api.getSession({ headers: request.headers })
  if (!session) {
    return Response.json(
      { error: "Authentication required" },
      { status: 401, headers: { "cache-control": "no-store" } }
    )
  }

  let input: ResearchRequest
  try {
    input = normalizedRequest(await request.json())
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request"
    return Response.json({ error: message }, { status: 400 })
  }
  console.info(JSON.stringify({
    event: "research.request",
    request_id: requestId,
    query_characters: input.query.length,
    has_conversation_context: Boolean(input.conversation),
    mode: input.mode,
  }))

  const encoder = new TextEncoder()
  let canceled = false
  const pipelineAbort = new AbortController()
  request.signal.addEventListener("abort", () => pipelineAbort.abort(), { once: true })
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: ResearchStreamEvent) => {
        if (canceled) return
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          canceled = true
          pipelineAbort.abort()
        }
      }
      const stage = (
        name: PipelineStage,
        status: "running" | "complete" | "error",
        message: string,
        detail?: string,
        elapsedMs?: number
      ) =>
        emit({
          type: "stage",
          stage: name,
          status,
          message,
          ...(detail ? { detail } : {}),
          ...(elapsedMs === undefined ? {} : { elapsed_ms: elapsedMs }),
        })

      void (async () => {
        try {
          const analysisStarted = performance.now()
          stage("spelling", "running", "Normalizing legal language and party names")
          const analysis = await analyzeQuery(
            input.query,
            input.mode,
            input.conversation,
            pipelineAbort.signal
          )
          const analysisMs = Math.round(performance.now() - analysisStarted)
          console.info(JSON.stringify({
            event: "research.analysis.complete",
            request_id: requestId,
            analyzer: analysis.analyzer,
            relationship: analysis.relationship,
            retrieval_order: analysis.retrieval_order,
            duration_ms: analysisMs,
          }))
          stage(
            "spelling",
            "complete",
            analysis.corrections.length
              ? `${analysis.corrections.length} correction${analysis.corrections.length === 1 ? "" : "s"} applied`
              : "No spelling changes required",
            analysis.corrections.map((item) => `${item.from} → ${item.to}`).join(" · "),
            analysisMs
          )
          stage("acronyms", "running", "Resolving Indian legal abbreviations")
          stage(
            "acronyms",
            "complete",
            analysis.acronym_expansions.length
              ? `${analysis.acronym_expansions.length} acronym${analysis.acronym_expansions.length === 1 ? "" : "s"} expanded`
              : "No acronyms required expansion",
            analysis.acronym_expansions
              .map((item) => `${item.acronym} → ${item.expansion}`)
              .join(" · ")
          )
          stage("context", "running", "Classifying intent and attaching legal context")
          stage(
            "context",
            "complete",
            analysis.intent.replaceAll("_", " "),
            analysis.legal_context.join(" · ") || "General Supreme Court case-law research"
          )
          emit({ type: "analysis", analysis })

          const retrievalStarted = performance.now()
          stage("retrieval", "running", "Searching 2.48M indexed judgment passages")
          const { chunks, widened } = await retrieveChunks({
            query: analysis.enriched_query,
            originalQuery: analysis.corrected_query,
            yearFrom: input.year_from,
            yearTo: input.year_to,
            order: analysis.retrieval_order,
            titleQuery: analysis.case_name_query ?? undefined,
            signal: pipelineAbort.signal,
          })
          const retrievalMs = Math.round(performance.now() - retrievalStarted)
          const judgmentCount = new Set(chunks.map((chunk) => chunk.judgment_id)).size
          stage(
            "retrieval",
            "complete",
            chunks.length
              ? `${chunks.length} passages from ${judgmentCount} judgments ranked`
              : "No grounded passages found",
            widened
              ? "Year filter widened after an empty first pass"
              : analysis.case_name_query
                ? "Direct title/citation match first · passage retrieval second"
                : "Hybrid FTS5 + BGE Vectorize · RRF fused",
            retrievalMs
          )
          emit({
            type: "sources",
            count: chunks.length,
            judgment_count: judgmentCount,
            chunks,
          })
          console.info(JSON.stringify({
            event: "research.retrieval.complete",
            request_id: requestId,
            passage_count: chunks.length,
            judgment_count: judgmentCount,
            duration_ms: retrievalMs,
          }))

          if (chunks.length === 0) {
            throw new Error(
              "The judgment index returned no relevant passages. Try a broader description, expand the date range, or remove a party-name spelling you are unsure about."
            )
          }

          const generationStarted = performance.now()
          const contextJudgmentIds = [...new Set(chunks.map((chunk) => chunk.judgment_id))].slice(0, 5)
          stage(
            "generation",
            "running",
            `Reading indexed judgment text for ${contextJudgmentIds.length} cases`
          )
          let judgmentContexts: JudgmentContext[] = []
          try {
            judgmentContexts = await retrieveJudgmentContexts({
              judgmentIds: contextJudgmentIds,
              signal: pipelineAbort.signal,
            })
            console.info(JSON.stringify({
              event: "research.context.complete",
              request_id: requestId,
              judgment_count: judgmentContexts.length,
              chunk_count: judgmentContexts.reduce(
                (total, context) => total + context.chunks.length,
                0
              ),
              truncated_count: judgmentContexts.filter((context) => context.truncated).length,
            }))
          } catch (contextError) {
            console.warn(JSON.stringify({
              event: "research.context.fallback",
              request_id: requestId,
              message:
                contextError instanceof Error
                  ? contextError.message
                  : "Indexed judgment context unavailable",
            }))
          }
          stage("generation", "running", "Explaining relevance from verified judgment text")
          const answer = await generateGroundedAnswer({
            query: analysis.corrected_query,
            mode: input.mode,
            analysis,
            chunks,
            judgmentContexts,
            signal: pipelineAbort.signal,
            onRetry: (reason) => {
              stage("generation", "running", "Grounding check failed; regenerating safely", reason)
            },
          })
          const generationMs = Math.round(performance.now() - generationStarted)
          console.info(JSON.stringify({
            event: "research.generation.complete",
            request_id: requestId,
            citation_count: answer.citations.length,
            confidence: answer.confidence,
            duration_ms: generationMs,
          }))
          stage(
            "generation",
            "complete",
            `${answer.citations.length} verified citation${answer.citations.length === 1 ? "" : "s"}`,
            `${answer.confidence.toUpperCase()} confidence`,
            generationMs
          )

          const result: ResearchResult = {
            ...answer,
            analysis,
            retrieval: {
              query: analysis.enriched_query,
              result_count: chunks.length,
              judgment_count: judgmentCount,
              latency_ms: retrievalMs,
              widened,
            },
          }
          emit({ type: "result", result })
        } catch (error) {
          const message = error instanceof Error ? error.message : "Research pipeline failed"
          console.error(JSON.stringify({
            event: "research.error",
            request_id: requestId,
            message,
          }))
          emit({ type: "error", message, retryable: !pipelineAbort.signal.aborted })
        } finally {
          if (!canceled) {
            try {
              controller.close()
            } catch {
              canceled = true
            }
          }
        }
      })()
    },
    cancel() {
      canceled = true
      pipelineAbort.abort()
    },
  })

  return new Response(stream, { headers: HEADERS })
}
