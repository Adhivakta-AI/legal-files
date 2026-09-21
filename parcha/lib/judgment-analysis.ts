import "server-only"

import type {
  JudgmentAiAnalysis,
  JudgmentAnalysisCitation,
  JudgmentAnalysisPoint,
  JudgmentTimelineEvent,
} from "@/lib/judgment-analysis-types"
import { generateJson } from "@/lib/research/gemini"
import { cloudflareEnv } from "@/lib/server-env"

const ANALYSIS_SCHEMA_VERSION = 3
const MAX_SOURCE_CHARACTERS = 1_500_000

interface JudgmentRecord {
  id: string
  title: string
  citation: string | null
  neutral_citation: string | null
  decision_date: string | null
  court: string
  case_number: string | null
}

interface ChunkRecord {
  rowid: number
  id: string
  pdf_page: number
  paragraph_index: number
  paragraph_number: string | null
  part_index: number
  text: string
}

interface CachedAnalysisRecord {
  source_fingerprint: string
  analysis_json: string
}

interface ModelPoint {
  text?: unknown
  source_chunk_ids?: unknown
}

interface ModelTimelineEvent {
  date?: unknown
  sort_key?: unknown
  event?: unknown
  significance?: unknown
  source_chunk_ids?: unknown
}

interface ModelAnalysis {
  overview?: ModelPoint
  facts?: ModelPoint[]
  issues?: ModelPoint[]
  holding?: ModelPoint[]
  reasoning?: ModelPoint[]
  outcome?: ModelPoint
  timeline?: ModelTimelineEvent[]
}

const pointSchema = {
  type: "object",
  properties: {
    text: { type: "string" },
    source_chunk_ids: { type: "string" },
  },
  required: ["text", "source_chunk_ids"],
}

const analysisSchema = {
  type: "object",
  properties: {
    overview: pointSchema,
    facts: {
      type: "array",
      items: pointSchema,
    },
    issues: {
      type: "array",
      items: pointSchema,
    },
    holding: {
      type: "array",
      items: pointSchema,
    },
    reasoning: {
      type: "array",
      items: pointSchema,
    },
    outcome: pointSchema,
    timeline: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string" },
          sort_key: { type: "string" },
          event: { type: "string" },
          significance: { type: "string" },
          source_chunk_ids: { type: "string" },
        },
        required: [
          "date",
          "sort_key",
          "event",
          "significance",
          "source_chunk_ids",
        ],
      },
    },
  },
  required: [
    "overview",
    "facts",
    "issues",
    "holding",
    "reasoning",
    "outcome",
    "timeline",
  ],
}

function cleanText(value: unknown, maxLength = 2_000): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : ""
}

function excerpt(text: string): string {
  const cleaned = cleanText(text, 520)
  return cleaned.length < text.trim().length ? `${cleaned}…` : cleaned
}

function sourceIds(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : typeof value === "string"
      ? value.split(/[\s,]+/)
      : []
  return [...new Set(values.map((id) => id.trim()).filter(Boolean))].slice(0, 4)
}

function citationFor(chunk: ChunkRecord): JudgmentAnalysisCitation {
  return {
    chunk_id: chunk.id,
    pdf_page: chunk.pdf_page,
    paragraph_number: chunk.paragraph_number,
    excerpt: excerpt(chunk.text),
  }
}

function validatePoint(
  value: ModelPoint | undefined,
  chunks: Map<string, ChunkRecord>
): JudgmentAnalysisPoint | null {
  const text = cleanText(value?.text)
  const citations = sourceIds(value?.source_chunk_ids)
    .map((id) => chunks.get(id))
    .filter((chunk): chunk is ChunkRecord => Boolean(chunk))
    .map(citationFor)
  return text && citations.length ? { text, citations } : null
}

function validatePoints(
  values: ModelPoint[] | undefined,
  chunks: Map<string, ChunkRecord>
): JudgmentAnalysisPoint[] {
  if (!Array.isArray(values)) return []
  return values
    .map((value) => validatePoint(value, chunks))
    .filter((value): value is JudgmentAnalysisPoint => Boolean(value))
}

function validateTimeline(
  values: ModelTimelineEvent[] | undefined,
  chunks: Map<string, ChunkRecord>
): JudgmentTimelineEvent[] {
  if (!Array.isArray(values)) return []
  const events = values
    .map((value, index) => {
      const date = cleanText(value.date, 100)
      const event = cleanText(value.event, 1_200)
      const significance = cleanText(value.significance, 1_200)
      const citations = sourceIds(value.source_chunk_ids)
        .map((id) => chunks.get(id))
        .filter((chunk): chunk is ChunkRecord => Boolean(chunk))
        .map(citationFor)
      if (!date || !event || !citations.length) return null
      return {
        result: { date, event, significance, citations },
        sortKey: cleanText(value.sort_key, 32),
        index,
      }
    })
    .filter(
      (
        value
      ): value is {
        result: JudgmentTimelineEvent
        sortKey: string
        index: number
      } => Boolean(value)
    )
  events.sort((a, b) => {
    if (!a.sortKey && !b.sortKey) return a.index - b.index
    if (!a.sortKey) return 1
    if (!b.sortKey) return -1
    return a.sortKey.localeCompare(b.sortKey) || a.index - b.index
  })
  return events.map(({ result }) => result)
}

function sourcePacket(chunks: ChunkRecord[]): {
  chunks: ChunkRecord[]
  text: string
} {
  const included: ChunkRecord[] = []
  const parts: string[] = []
  let used = 0
  for (const chunk of chunks) {
    const block = `\n[${chunk.id} | PDF page ${chunk.pdf_page}${
      chunk.paragraph_number ? ` | paragraph ${chunk.paragraph_number}` : ""
    }]\n${chunk.text.trim()}\n`
    if (used + block.length > MAX_SOURCE_CHARACTERS && included.length) break
    included.push(chunk)
    parts.push(block)
    used += block.length
  }
  return { chunks: included, text: parts.join("") }
}

function fingerprint(chunks: ChunkRecord[]): string {
  const characters = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0)
  let hash = 2_166_136_261
  for (const chunk of chunks) {
    const value = `${chunk.id}\u0000${chunk.text}\u0000`
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16_777_619)
    }
  }
  return `${ANALYSIS_SCHEMA_VERSION}:${chunks.length}:${characters}:${(
    hash >>> 0
  ).toString(16)}`
}

function promptFor(judgment: JudgmentRecord, packet: string): string {
  return `Prepare a source-grounded analysis of this Indian judgment.

CASE METADATA
Title: ${judgment.title}
Court: ${judgment.court}
Decision date: ${judgment.decision_date ?? "not supplied"}
Citation: ${judgment.citation ?? judgment.neutral_citation ?? "not supplied"}
Case number: ${judgment.case_number ?? "not supplied"}

RULES
- Use only the supplied judgment text. Do not add legal knowledge from memory.
- Distinguish allegations, party submissions, procedural history, and the Court's findings.
- Summarise the actual ratio and outcome, not merely the headnote or opening facts.
- Every point and every dated event must cite one or more exact chunk IDs from the source.
- Return source_chunk_ids as one comma-separated string of exact chunk IDs, never as an array.
- Include a date only when the source supplies it. Preserve partial or relative dates as written.
- For sort_key use YYYY-MM-DD, YYYY-MM, or YYYY where the source permits; otherwise use an empty string.
- Omit repetitive, immaterial, or merely citation-history dates.
- If an issue or fact is unclear, say so rather than infer it.
- Be concise: overview at most 140 words; 4-7 material facts; 2-5 issues; 2-5 holdings;
  4-8 reasoning points; outcome at most 120 words; and no more than 20 material dated events.
- Keep every list item under 90 words and omit repetition.

INDEXED JUDGMENT TEXT
${packet}`
}

function emptyPoint(): JudgmentAnalysisPoint {
  return {
    text: "The indexed text did not support a grounded answer.",
    citations: [],
  }
}

function finalise(
  judgmentId: string,
  model: ModelAnalysis,
  allChunks: ChunkRecord[],
  analysedChunks: ChunkRecord[]
): JudgmentAiAnalysis {
  const available = new Map(analysedChunks.map((chunk) => [chunk.id, chunk]))
  const overview = validatePoint(model.overview, available)
  const outcome = validatePoint(model.outcome, available)
  const facts = validatePoints(model.facts, available)
  const issues = validatePoints(model.issues, available)
  const holding = validatePoints(model.holding, available)
  const reasoning = validatePoints(model.reasoning, available)
  if (
    !overview ||
    !outcome ||
    !facts.length ||
    !issues.length ||
    !holding.length
  ) {
    throw new Error(
      "Gemini returned an incomplete source-grounded judgment analysis"
    )
  }
  const allPages = new Set(allChunks.map((chunk) => chunk.pdf_page))
  const analysedPages = new Set(analysedChunks.map((chunk) => chunk.pdf_page))
  return {
    judgment_id: judgmentId,
    generated_at: new Date().toISOString(),
    cached: false,
    summary: {
      overview: overview ?? emptyPoint(),
      facts,
      issues,
      holding,
      reasoning,
      outcome: outcome ?? emptyPoint(),
    },
    timeline: validateTimeline(model.timeline, available),
    coverage: {
      source_chunks: allChunks.length,
      analysed_chunks: analysedChunks.length,
      source_pages: allPages.size,
      analysed_pages: analysedPages.size,
      complete: analysedChunks.length === allChunks.length,
    },
  }
}

function parseCached(
  value: string,
  judgmentId: string
): JudgmentAiAnalysis | null {
  try {
    const parsed = JSON.parse(value) as JudgmentAiAnalysis
    if (
      parsed.judgment_id !== judgmentId ||
      !parsed.summary ||
      !parsed.coverage
    ) {
      return null
    }
    return { ...parsed, cached: true }
  } catch {
    return null
  }
}

export async function getOrCreateJudgmentAnalysis(
  judgmentId: string,
  signal?: AbortSignal
): Promise<JudgmentAiAnalysis | null> {
  const db = cloudflareEnv().LEGAL_DB
  const [judgment, chunkResult] = await Promise.all([
    db
      .prepare(
        `SELECT id, title, citation, neutral_citation, decision_date,
                court, case_number
           FROM judgments
          WHERE id = ?1`
      )
      .bind(judgmentId)
      .first<JudgmentRecord>(),
    db
      .prepare(
        `SELECT rowid, id, pdf_page, paragraph_index, paragraph_number,
                part_index, text
           FROM chunks
          WHERE judgment_id = ?1
          ORDER BY pdf_page, paragraph_index, part_index`
      )
      .bind(judgmentId)
      .all<ChunkRecord>(),
  ])
  if (!judgment) return null
  const chunks = (chunkResult.results as ChunkRecord[]).filter((chunk) =>
    chunk.text.trim()
  )
  if (!chunks.length) throw new Error("No indexed judgment text is available")

  const sourceFingerprint = fingerprint(chunks)
  const cached = await db
    .prepare(
      `SELECT source_fingerprint, analysis_json
         FROM judgment_ai_analyses
        WHERE judgment_id = ?1 AND schema_version = ?2`
    )
    .bind(judgmentId, ANALYSIS_SCHEMA_VERSION)
    .first<CachedAnalysisRecord>()
  if (cached?.source_fingerprint === sourceFingerprint) {
    const analysis = parseCached(cached.analysis_json, judgmentId)
    if (analysis) return analysis
  }

  const packet = sourcePacket(chunks)
  const modelAnalysis = await generateJson<ModelAnalysis>({
    systemInstruction:
      "You are an Indian judgment analyst. Produce concise, neutral, source-bound work. Never invent a fact, date, holding, authority, or source ID.",
    prompt: promptFor(judgment, packet.text),
    schema: analysisSchema,
    signal,
    timeoutMs: 90_000,
    maxOutputTokens: 12_288,
    temperature: 0.05,
    thinkingBudget: 1_024,
  })
  const analysis = finalise(judgmentId, modelAnalysis, chunks, packet.chunks)
  await db
    .prepare(
      `INSERT INTO judgment_ai_analyses (
         judgment_id, schema_version, source_fingerprint, analysis_json,
         source_chunk_count, analysed_chunk_count, generated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(judgment_id) DO UPDATE SET
         schema_version = excluded.schema_version,
         source_fingerprint = excluded.source_fingerprint,
         analysis_json = excluded.analysis_json,
         source_chunk_count = excluded.source_chunk_count,
         analysed_chunk_count = excluded.analysed_chunk_count,
         generated_at = excluded.generated_at`
    )
    .bind(
      judgmentId,
      ANALYSIS_SCHEMA_VERSION,
      sourceFingerprint,
      JSON.stringify(analysis),
      chunks.length,
      packet.chunks.length,
      analysis.generated_at
    )
    .run()
  return analysis
}
