import { analyzeQuery } from "@/lib/research/analyzer"
import { generateGroundedAnswer } from "@/lib/research/grounding"
import { retrieveChunks } from "@/lib/research/search"
import type {
  PipelineStage,
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
  return { query, mode, ...(yearFrom ? { year_from: yearFrom } : {}), ...(yearTo ? { year_to: yearTo } : {}) }
}

export async function POST(request: Request): Promise<Response> {
  let input: ResearchRequest
  try {
    input = normalizedRequest(await request.json())
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request"
    return Response.json({ error: message }, { status: 400 })
  }

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
          const analysis = await analyzeQuery(input.query, input.mode, pipelineAbort.signal)
          const analysisMs = Math.round(performance.now() - analysisStarted)
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
            originalQuery: input.query,
            yearFrom: input.year_from,
            yearTo: input.year_to,
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
            widened ? "Year filter widened after an empty first pass" : "Hybrid FTS5 + BGE Vectorize · RRF fused",
            retrievalMs
          )
          emit({
            type: "sources",
            count: chunks.length,
            judgment_count: judgmentCount,
            chunks,
          })

          if (chunks.length === 0) {
            throw new Error(
              "The judgment index returned no relevant passages. Try a broader description, expand the date range, or remove a party-name spelling you are unsure about."
            )
          }

          const generationStarted = performance.now()
          stage("generation", "running", "Drafting against the retrieved citation allow-list")
          const answer = await generateGroundedAnswer({
            query: input.query,
            mode: input.mode,
            analysis,
            chunks,
            signal: pipelineAbort.signal,
            onDelta: (delta) => emit({ type: "answer_delta", delta }),
            onRetry: (reason) => {
              emit({ type: "answer_reset", reason })
              stage("generation", "running", "Grounding check failed; regenerating safely", reason)
            },
          })
          const generationMs = Math.round(performance.now() - generationStarted)
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
