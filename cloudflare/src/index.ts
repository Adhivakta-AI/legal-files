interface Env {
  AI: Ai;
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  LEGAL_VECTORIZE: VectorizeIndex;
  DOCUMENTS: R2Bucket;
  BGE_MODEL: string;
  EMBEDDING_POOLING: string;
  SEMANTIC_CANDIDATES: string;
  KEYWORD_CANDIDATES: string;
  RRF_K: string;
  CORS_ORIGIN: string;
  SEARCH_SERVICE_TOKEN: string;
  OPENSEARCH_API_URL?: string;
  OPENSEARCH_BROWSE_API_URL?: string;
  OPENSEARCH_API_TOKEN?: string;
}

interface SearchBody {
  query?: unknown;
  title_query?: unknown;
  limit?: unknown;
  year_from?: unknown;
  year_to?: unknown;
  sort?: unknown;
}

interface ContextBody {
  judgment_ids?: unknown;
  max_chars_per_judgment?: unknown;
}

interface LegalSearchBody {
  query?: unknown;
  limit?: unknown;
}

interface CitatorBody {
  judgment_id?: unknown;
  limit?: unknown;
  reviewed_only?: unknown;
}

interface BrowseBody {
  ids?: unknown;
  q?: unknown;
  party?: unknown;
  year_from?: unknown;
  year_to?: unknown;
  date_from?: unknown;
  date_to?: unknown;
  judges?: unknown;
  disposal?: unknown;
  era?: unknown;
  language?: unknown;
  court?: unknown;
  bench_min?: unknown;
  bench_max?: unknown;
  bench?: unknown;
  reporter?: unknown;
  neutral_citation?: unknown;
  sort?: unknown;
  page?: unknown;
  page_size?: unknown;
  facets?: unknown;
}

interface JudgmentRow {
  id: string;
  title: string;
  petitioner: string | null;
  respondent: string | null;
  citation: string | null;
  neutral_citation: string | null;
  cnr: string | null;
  case_number: string | null;
  court: string;
  decision_date: string | null;
  decision_year: number | null;
  disposal_nature: string | null;
  era: string | null;
  bench_size: number | null;
  available_languages: string | null;
  pdf_url: string;
  pdf_key: string | null;
}

interface FacetBucket {
  value: string | number;
  count: number;
}

interface OpenSearchBrowseResult {
  ids: string[];
  total: number;
  facets?: Record<string, FacetBucket[]>;
}

interface Candidate {
  id: string;
  score: number;
}

type KeywordBackend = "d1" | "opensearch";

interface TitleCandidate {
  judgmentId: string;
  score: number;
}

interface ChunkRow {
  chunk_id: string;
  judgment_id: string;
  title: string;
  citation: string | null;
  decision_date: string | null;
  judge: string | null;
  chunk_text: string;
  pdf_url: string;
  pdf_page: number;
  paragraph_number: string | null;
  text_source: string;
}

interface LegalReference {
  documentId: string;
  unitKind: "article" | "section";
  unitNumber: string;
}

interface LegalChunkRow {
  chunk_id: string;
  document_id: string;
  unit_id: string;
  document_title: string;
  short_title: string;
  source_kind: string;
  unit_kind: string;
  unit_number: string;
  parent_label: string | null;
  heading: string;
  part_index: number;
  chunk_text: string;
  source_url: string;
  canonical_url: string;
  authority: string;
  pdf_page_start: number | null;
  pdf_page_end: number | null;
  effective_from: string | null;
  current_through: string | null;
  commencement_note: string | null;
}

interface CitatorRow {
  mention_id: string;
  citing_judgment_id: string;
  citing_title: string;
  citing_citation: string | null;
  citing_decision_date: string | null;
  citing_chunk_id: string;
  cited_case_name: string;
  cited_reporter_citation: string | null;
  pdf_page: number;
  mention_evidence: string;
  resolution_status: string;
  match_confidence: number | null;
  treatment: string | null;
  treatment_scope: string | null;
  treatment_evidence: string | null;
  treatment_confidence: number | null;
  review_status: string | null;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function jsonResponse(env: Env, body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      "access-control-allow-origin": env.CORS_ORIGIN,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "Content-Type,Authorization",
      "cache-control": "no-store",
    },
  });
}

async function secureEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

async function isAuthorized(request: Request, env: Env): Promise<boolean> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || !env.SEARCH_SERVICE_TOKEN) return false;
  const supplied = authorization.slice("Bearer ".length);
  return supplied.length > 0 && secureEqual(supplied, env.SEARCH_SERVICE_TOKEN);
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Expected an integer between ${min} and ${max}`);
  }
  return value;
}

function optionalYear(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1800 || value > 2200) {
    throw new Error("Year must be an integer between 1800 and 2200");
  }
  return value;
}

function ftsExpression(query: string): string {
  const tokens = query.normalize("NFKC").match(/[\p{L}\p{N}]+/gu)?.slice(0, 24) ?? [];
  if (tokens.length === 0) throw new Error("Query must contain searchable characters");
  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
}

const TITLE_STOP_WORDS = new Set([
  "and", "case", "in", "india", "ors", "others", "state", "the", "union", "v", "vs", "versus",
]);

function titleTokens(value: string): string[] {
  return [
    ...new Set(
      (value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
        (token) => token.length >= 2 && !TITLE_STOP_WORDS.has(token),
      ),
    ),
  ];
}

function directTitleScore(query: string, title: string, citation: string | null): number {
  const requested = titleTokens(query);
  if (!requested.length) return 0;
  const available = new Set(titleTokens(`${title} ${citation ?? ""}`));
  const matches = requested.filter((token) => available.has(token)).length;
  const coverage = matches / requested.length;
  const normalizedQuery = requested.join(" ");
  const normalizedTitle = titleTokens(title).join(" ");
  const exactBonus =
    normalizedQuery === normalizedTitle
      ? 0.5
      : normalizedTitle.includes(normalizedQuery) || normalizedQuery.includes(normalizedTitle)
        ? 0.2
        : 0;
  return coverage + exactBonus;
}

async function titleCandidates(
  env: Env,
  query: string,
  yearFrom: number | null,
  yearTo: number | null,
): Promise<TitleCandidate[]> {
  const result = await env.DB.prepare(
    `SELECT j.id, j.title, j.citation
       FROM judgments_fts
       JOIN judgments j ON j.rowid = judgments_fts.rowid
      WHERE judgments_fts MATCH ?1
        AND (?2 IS NULL OR j.decision_year >= ?2)
        AND (?3 IS NULL OR j.decision_year <= ?3)
      ORDER BY bm25(judgments_fts)
      LIMIT 50`,
  )
    .bind(ftsExpression(query), yearFrom, yearTo)
    .all<{ id: string; title: string; citation: string | null }>();

  return result.results
    .map((row) => ({ judgmentId: row.id, score: directTitleScore(query, row.title, row.citation) }))
    .filter((candidate) => candidate.score >= 0.6)
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);
}

async function safeTitleCandidates(
  env: Env,
  query: string,
  yearFrom: number | null,
  yearTo: number | null,
): Promise<TitleCandidate[]> {
  try {
    return await titleCandidates(env, query, yearFrom, yearTo);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Title lookup failed";
    console.warn(JSON.stringify({ event: "title_lookup.unavailable", message }));
    return [];
  }
}

async function fetchTitleChunks(
  env: Env,
  candidates: TitleCandidate[],
): Promise<Array<ChunkRow & { title_match_score: number }>> {
  if (!candidates.length) return [];
  const results = await env.DB.batch<ChunkRow>(
    candidates.map((candidate) =>
      env.DB.prepare(
        `SELECT c.id AS chunk_id, c.judgment_id, j.title, j.citation,
                j.decision_date, j.judge, c.text AS chunk_text, j.pdf_url,
                c.pdf_page, c.paragraph_number, c.text_source
           FROM chunks c
           JOIN judgments j ON j.id = c.judgment_id
          WHERE c.judgment_id = ?1
          ORDER BY c.pdf_page, c.paragraph_index, c.part_index
          LIMIT 1`,
      ).bind(candidate.judgmentId),
    ),
  );
  return results.flatMap((result, index) => {
    const chunk = result.results[0];
    return chunk ? [{ ...chunk, title_match_score: candidates[index].score }] : [];
  });
}

function vectorFilter(
  yearFrom: number | null,
  yearTo: number | null,
): VectorizeVectorMetadataFilter | undefined {
  if (yearFrom !== null && yearTo !== null) {
    return { decision_year: { $gte: yearFrom, $lte: yearTo } };
  }
  if (yearFrom !== null) return { decision_year: { $gte: yearFrom } };
  if (yearTo !== null) return { decision_year: { $lte: yearTo } };
  return undefined;
}

async function d1KeywordCandidates(
  env: Env,
  query: string,
  limit: number,
  yearFrom: number | null,
  yearTo: number | null,
): Promise<Candidate[]> {
  const result = await env.DB.prepare(
    `SELECT c.id, bm25(chunks_fts) AS score
       FROM chunks_fts
       JOIN chunks c ON c.rowid = chunks_fts.rowid
       JOIN judgments j ON j.id = c.judgment_id
      WHERE chunks_fts MATCH ?1
        AND (?2 IS NULL OR j.decision_year >= ?2)
        AND (?3 IS NULL OR j.decision_year <= ?3)
      ORDER BY score
      LIMIT ?4`,
  )
    .bind(ftsExpression(query), yearFrom, yearTo, limit)
    .all<{ id: string; score: number }>();

  return result.results.map((row) => ({ id: row.id, score: row.score }));
}

function openSearchApiUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("OPENSEARCH_API_URL must use HTTPS");
  }
  return url.toString();
}

function isCandidate(value: unknown): value is Candidate {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Candidate>;
  return typeof candidate.id === "string" && typeof candidate.score === "number";
}

async function openSearchKeywordCandidates(
  env: Env,
  query: string,
  limit: number,
  yearFrom: number | null,
  yearTo: number | null,
): Promise<Candidate[]> {
  if (!env.OPENSEARCH_API_URL || !env.OPENSEARCH_API_TOKEN) {
    throw new Error("OpenSearch is not configured");
  }
  const response = await fetch(openSearchApiUrl(env.OPENSEARCH_API_URL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENSEARCH_API_TOKEN}`,
    },
    body: JSON.stringify({
      query,
      limit,
      ...(yearFrom === null ? {} : { year_from: yearFrom }),
      ...(yearTo === null ? {} : { year_to: yearTo }),
    }),
    signal: AbortSignal.timeout(5_000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    results?: unknown;
    error?: unknown;
  };
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : "OpenSearch request failed";
    throw new Error(`OpenSearch gateway returned ${response.status}: ${message}`);
  }
  if (!Array.isArray(payload.results)) throw new Error("OpenSearch returned an invalid result set");
  return payload.results.filter(isCandidate).slice(0, limit);
}

async function keywordCandidates(
  env: Env,
  query: string,
  limit: number,
  yearFrom: number | null,
  yearTo: number | null,
): Promise<{ candidates: Candidate[]; backend: KeywordBackend }> {
  if (env.OPENSEARCH_API_URL && env.OPENSEARCH_API_TOKEN) {
    const startedAt = performance.now();
    try {
      const candidates = await openSearchKeywordCandidates(env, query, limit, yearFrom, yearTo);
      console.info(JSON.stringify({
        event: "keyword_search.complete",
        backend: "opensearch",
        result_count: candidates.length,
        duration_ms: Math.round(performance.now() - startedAt),
      }));
      return { candidates, backend: "opensearch" };
    } catch (error) {
      console.warn(JSON.stringify({
        event: "keyword_search.fallback",
        from: "opensearch",
        to: "d1",
        message: error instanceof Error ? error.message : "OpenSearch unavailable",
      }));
    }
  }
  return {
    candidates: await d1KeywordCandidates(env, query, limit, yearFrom, yearTo),
    backend: "d1",
  };
}

async function embedQuery(env: Env, query: string): Promise<number[]> {
  const output = (await env.AI.run(env.BGE_MODEL as keyof AiModels, {
    text: [query],
    pooling: env.EMBEDDING_POOLING,
  } as never)) as unknown as { data?: number[][] };
  const vector = output.data?.[0];
  if (!vector || vector.length !== 384) throw new Error("Workers AI returned an invalid embedding");
  return vector;
}

async function semanticCandidates(
  env: Env,
  query: string,
  limit: number,
  yearFrom: number | null,
  yearTo: number | null,
): Promise<Candidate[]> {
  const embedding = await embedQuery(env, query);
  const result = await env.VECTORIZE.query(embedding, {
    topK: limit,
    returnMetadata: "none",
    filter: vectorFilter(yearFrom, yearTo),
  });
  return result.matches.map((match) => ({ id: match.id, score: match.score }));
}

const LEGAL_DOCUMENT_PATTERNS: Array<[string, RegExp]> = [
  ["bns-2023", /\b(?:BNS|Bharatiya\s+Nyaya\s+Sanhita)\b/i],
  ["bnss-2023", /\b(?:BNSS|Bharatiya\s+Nagarik\s+Suraksha\s+Sanhita)\b/i],
  [
    "constitution-of-india",
    /\b(?:Constitution(?:\s+of\s+India)?|Indian\s+Constitution|COI)\b/i,
  ],
];

function detectedLegalDocumentIds(query: string): string[] {
  return LEGAL_DOCUMENT_PATTERNS.filter(([, pattern]) => pattern.test(query)).map(([id]) => id);
}

function directLegalReferences(query: string): LegalReference[] {
  const detected = detectedLegalDocumentIds(query);
  const references = new Map<string, LegalReference>();
  const add = (reference: LegalReference) => {
    const key = `${reference.documentId}:${reference.unitKind}:${reference.unitNumber}`;
    if (!references.has(key)) references.set(key, reference);
  };

  const sectionDocuments = detected.filter((id) => id === "bns-2023" || id === "bnss-2023");
  const sectionPattern = /\bsections?\s+(\d{1,3}(?:\s*(?:,|and|&)\s*\d{1,3})*)/gi;
  for (const match of query.matchAll(sectionPattern)) {
    const numbers = match[1].match(/\d{1,3}/g) ?? [];
    for (const documentId of sectionDocuments) {
      for (const unitNumber of numbers) add({ documentId, unitKind: "section", unitNumber });
    }
  }

  const articleNumber = String.raw`\d{1,3}(?:-[A-Z]{1,2}|[A-Z]{0,2})`;
  const articlePattern = new RegExp(
    String.raw`\barticles?\s+(${articleNumber}(?:\s*(?:,|and|&)\s*${articleNumber})*)`,
    "gi",
  );
  for (const match of query.matchAll(articlePattern)) {
    const numbers = match[1].match(new RegExp(articleNumber, "gi")) ?? [];
    for (const unitNumber of numbers) {
      add({
        documentId: "constitution-of-india",
        unitKind: "article",
        unitNumber: unitNumber.toUpperCase(),
      });
    }
  }

  return [...references.values()].slice(0, 8);
}

function legalVectorFilter(documentIds: string[]): VectorizeVectorMetadataFilter | undefined {
  if (documentIds.length === 1) return { document_id: documentIds[0] };
  if (documentIds.length > 1) return { document_id: { $in: documentIds } };
  return undefined;
}

async function legalKeywordCandidates(
  env: Env,
  query: string,
  limit: number,
  documentIds: string[],
): Promise<Candidate[]> {
  const documentClause = documentIds.length
    ? ` AND lc.document_id IN (${documentIds.map(() => "?").join(",")})`
    : "";
  const result = await env.DB.prepare(
    `SELECT lc.id, bm25(legal_chunks_fts) AS score
       FROM legal_chunks_fts
       JOIN legal_chunks lc ON lc.rowid = legal_chunks_fts.rowid
      WHERE legal_chunks_fts MATCH ?${documentClause}
      ORDER BY score
      LIMIT ?`,
  )
    .bind(ftsExpression(query), ...documentIds, limit)
    .all<{ id: string; score: number }>();
  return result.results.map((row) => ({ id: row.id, score: row.score }));
}

async function legalSemanticCandidates(
  env: Env,
  query: string,
  limit: number,
  documentIds: string[],
): Promise<Candidate[]> {
  const embedding = await embedQuery(env, query);
  const result = await env.LEGAL_VECTORIZE.query(embedding, {
    topK: limit,
    returnMetadata: "none",
    filter: legalVectorFilter(documentIds),
  });
  return result.matches.map((match) => ({ id: match.id, score: match.score }));
}

const LEGAL_CHUNK_COLUMNS = `
  lc.id AS chunk_id, lc.document_id, lc.unit_id,
  ld.title AS document_title, ld.short_title, ld.source_kind,
  lc.unit_kind, lc.unit_number, lc.parent_label, lc.heading,
  lc.part_index, lc.text AS chunk_text, ld.source_url, ld.canonical_url,
  ld.authority, lc.pdf_page_start, lc.pdf_page_end,
  ld.effective_from, ld.current_through,
  json_extract(ld.metadata_json, '$.commencement_note') AS commencement_note`;

async function fetchLegalChunks(env: Env, ids: string[]): Promise<Map<string, LegalChunkRow>> {
  const statements: D1PreparedStatement[] = [];
  for (let start = 0; start < ids.length; start += 50) {
    const group = ids.slice(start, start + 50);
    const placeholders = group.map(() => "?").join(",");
    statements.push(
      env.DB.prepare(
        `SELECT ${LEGAL_CHUNK_COLUMNS}
           FROM legal_chunks lc
           JOIN legal_documents ld ON ld.id = lc.document_id
          WHERE lc.id IN (${placeholders})`,
      ).bind(...group),
    );
  }
  if (!statements.length) return new Map();
  const results = await env.DB.batch<LegalChunkRow>(statements);
  return new Map(results.flatMap((result) => result.results).map((row) => [row.chunk_id, row]));
}

async function directLegalChunks(env: Env, references: LegalReference[]): Promise<LegalChunkRow[]> {
  if (!references.length) return [];
  const results = await env.DB.batch<LegalChunkRow>(
    references.map((reference) =>
      env.DB.prepare(
        `SELECT ${LEGAL_CHUNK_COLUMNS}
           FROM legal_chunks lc
           JOIN legal_documents ld ON ld.id = lc.document_id
          WHERE lc.document_id = ?1 AND lc.unit_kind = ?2 AND lc.unit_number = ?3
          ORDER BY lc.part_index
          LIMIT 12`,
      ).bind(reference.documentId, reference.unitKind, reference.unitNumber),
    ),
  );
  return results.flatMap((result) => result.results);
}

async function legalSearch(env: Env, request: Request): Promise<Response> {
  const startedAt = performance.now();
  let body: LegalSearchBody;
  try {
    body = (await request.json()) as LegalSearchBody;
  } catch {
    return jsonResponse(env, { error: "Request body must be valid JSON" }, 400);
  }

  try {
    if (typeof body.query !== "string") throw new Error("query must be a string");
    const query = body.query.trim().replace(/\s+/g, " ");
    if (query.length < 3 || query.length > 500) {
      throw new Error("query must be between 3 and 500 characters");
    }
    const limit = integer(body.limit, 12, 1, 30);
    const candidateLimit = Math.min(Math.max(limit * 5, 40), 100);
    const documentIds = detectedLegalDocumentIds(query);
    const references = directLegalReferences(query);
    const [keywords, semantics, directChunks] = await Promise.all([
      legalKeywordCandidates(env, query, candidateLimit, documentIds),
      legalSemanticCandidates(env, query, candidateLimit, documentIds),
      directLegalChunks(env, references),
    ]);

    const rrfK = integer(Number(env.RRF_K), 60, 1, 1000);
    const combined = new Map<
      string,
      { rrf: number; keywordScore: number | null; semanticScore: number | null }
    >();
    keywords.forEach((candidate, rank) => {
      combined.set(candidate.id, {
        rrf: 1 / (rrfK + rank + 1),
        keywordScore: candidate.score,
        semanticScore: null,
      });
    });
    semantics.forEach((candidate, rank) => {
      const current = combined.get(candidate.id) ?? {
        rrf: 0,
        keywordScore: null,
        semanticScore: null,
      };
      current.rrf += 1 / (rrfK + rank + 1);
      current.semanticScore = candidate.score;
      combined.set(candidate.id, current);
    });

    const ranked = [...combined.entries()]
      .sort((left, right) => right[1].rrf - left[1].rrf)
      .slice(0, limit);
    const chunks = await fetchLegalChunks(env, ranked.map(([id]) => id));
    const passageResults = ranked.flatMap(([id, scores]) => {
      const chunk = chunks.get(id);
      return chunk
        ? [{
            ...chunk,
            keyword_score: scores.keywordScore,
            semantic_score: scores.semanticScore,
            rrf_score: scores.rrf,
            direct_match: false,
          }]
        : [];
    });
    const directIds = new Set(directChunks.map((chunk) => chunk.chunk_id));
    const directResults = directChunks.map((chunk) => ({
      ...chunk,
      keyword_score: null,
      semantic_score: null,
      rrf_score: 1,
      direct_match: true,
    }));
    const results = [
      ...directResults,
      ...passageResults.filter((chunk) => !directIds.has(chunk.chunk_id)),
    ].slice(0, limit);

    console.info(JSON.stringify({
      event: "legal_search.complete",
      result_count: results.length,
      direct_reference_count: references.length,
      document_filters: documentIds,
      duration_ms: Math.round(performance.now() - startedAt),
    }));
    return jsonResponse(env, { query, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Legal search failed";
    console.error(JSON.stringify({ event: "legal_search.error", message }));
    return jsonResponse(env, { error: message }, 400);
  }
}

async function fetchChunks(env: Env, ids: string[]): Promise<Map<string, ChunkRow>> {
  const statements: D1PreparedStatement[] = [];
  for (let start = 0; start < ids.length; start += 50) {
    const group = ids.slice(start, start + 50);
    const placeholders = group.map(() => "?").join(",");
    statements.push(
      env.DB.prepare(
        `SELECT c.id AS chunk_id, c.judgment_id, j.title, j.citation,
                j.decision_date, j.judge, c.text AS chunk_text, j.pdf_url,
                c.pdf_page, c.paragraph_number, c.text_source
           FROM chunks c
           JOIN judgments j ON j.id = c.judgment_id
          WHERE c.id IN (${placeholders})`,
      ).bind(...group),
    );
  }
  if (statements.length === 0) return new Map();
  const results = await env.DB.batch<ChunkRow>(statements);
  return new Map(results.flatMap((item) => item.results).map((row) => [row.chunk_id, row]));
}

async function search(env: Env, request: Request): Promise<Response> {
  const startedAt = performance.now();
  let body: SearchBody;
  try {
    body = (await request.json()) as SearchBody;
  } catch {
    return jsonResponse(env, { error: "Request body must be valid JSON" }, 400);
  }

  try {
    if (typeof body.query !== "string") throw new Error("query must be a string");
    const query = body.query.trim().replace(/\s+/g, " ");
    if (query.length < 3 || query.length > 500) {
      throw new Error("query must be between 3 and 500 characters");
    }
    const limit = integer(body.limit, 10, 1, 50);
    const yearFrom = optionalYear(body.year_from);
    const yearTo = optionalYear(body.year_to);
    const sort = body.sort === "recent" ? "recent" : "relevance";
    const titleQuery =
      typeof body.title_query === "string"
        ? body.title_query.trim().replace(/\s+/g, " ").slice(0, 240)
        : "";
    if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
      throw new Error("year_from must be less than or equal to year_to");
    }

    const keywordLimit = integer(Number(env.KEYWORD_CANDIDATES), 80, 1, 100);
    const semanticLimit = integer(Number(env.SEMANTIC_CANDIDATES), 80, 1, 100);
    const [keywordResult, semantics, directCandidates] = await Promise.all([
      keywordCandidates(env, query, keywordLimit, yearFrom, yearTo),
      semanticCandidates(env, query, semanticLimit, yearFrom, yearTo),
      titleQuery ? safeTitleCandidates(env, titleQuery, yearFrom, yearTo) : Promise.resolve([]),
    ]);
    const keywords = keywordResult.candidates;

    const rrfK = integer(Number(env.RRF_K), 60, 1, 1000);
    const combined = new Map<
      string,
      { rrf: number; keywordScore: number | null; semanticScore: number | null }
    >();
    keywords.forEach((candidate, rank) => {
      combined.set(candidate.id, {
        rrf: 1 / (rrfK + rank + 1),
        keywordScore: candidate.score,
        semanticScore: null,
      });
    });
    semantics.forEach((candidate, rank) => {
      const current = combined.get(candidate.id) ?? {
        rrf: 0,
        keywordScore: null,
        semanticScore: null,
      };
      current.rrf += 1 / (rrfK + rank + 1);
      current.semanticScore = candidate.score;
      combined.set(candidate.id, current);
    });

    const candidateLimit = sort === "recent" ? Math.min(Math.max(limit * 4, limit), 50) : limit;
    const ranked = [...combined.entries()]
      .sort((a, b) => b[1].rrf - a[1].rrf)
      .slice(0, candidateLimit);
    const chunks = await fetchChunks(env, ranked.map(([id]) => id));
    let passageResults = ranked.flatMap(([id, scores]) => {
      const chunk = chunks.get(id);
      return chunk
        ? [{
            ...chunk,
            keyword_score: scores.keywordScore,
            semantic_score: scores.semanticScore,
            rrf_score: scores.rrf,
          }]
        : [];
    });
    if (sort === "recent") {
      passageResults = passageResults.sort((left, right) => {
        const dateOrder = (right.decision_date ?? "").localeCompare(left.decision_date ?? "");
        return dateOrder || right.rrf_score - left.rrf_score;
      });
    }
    const directChunks = await fetchTitleChunks(env, directCandidates);
    const directJudgments = new Set(directChunks.map((chunk) => chunk.judgment_id));
    const directResults = directChunks.map((chunk) => ({
      ...chunk,
      keyword_score: null,
      semantic_score: null,
      rrf_score: 1 + chunk.title_match_score,
    }));
    const results = [
      ...directResults,
      ...passageResults.filter((chunk) => !directJudgments.has(chunk.judgment_id)),
    ].slice(0, limit);

    console.info(JSON.stringify({
      event: "search.complete",
      result_count: results.length,
      direct_title_matches: directResults.length,
      keyword_backend: keywordResult.backend,
      sort,
      duration_ms: Math.round(performance.now() - startedAt),
    }));

    return jsonResponse(env, { query, limit, year_from: yearFrom, year_to: yearTo, sort, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed";
    console.error(JSON.stringify({ event: "search.error", message }));
    return jsonResponse(env, { error: message }, 400);
  }
}

async function judgmentContext(env: Env, request: Request): Promise<Response> {
  const startedAt = performance.now();
  let body: ContextBody;
  try {
    body = (await request.json()) as ContextBody;
  } catch {
    return jsonResponse(env, { error: "Request body must be valid JSON" }, 400);
  }

  try {
    if (!Array.isArray(body.judgment_ids)) throw new Error("judgment_ids must be an array");
    const judgmentIds = [...new Set(body.judgment_ids)].filter(
      (value): value is string => typeof value === "string" && value.length > 0 && value.length <= 160,
    );
    if (judgmentIds.length === 0 || judgmentIds.length > 5) {
      throw new Error("judgment_ids must contain between 1 and 5 valid IDs");
    }
    const maxCharacters = integer(body.max_chars_per_judgment, 80_000, 10_000, 120_000);
    const statements = judgmentIds.map((judgmentId) =>
      env.DB.prepare(
        `SELECT c.id AS chunk_id, c.judgment_id, j.title, j.citation,
                j.decision_date, j.judge, c.text AS chunk_text, j.pdf_url,
                c.pdf_page, c.paragraph_number, c.text_source
           FROM chunks c
           JOIN judgments j ON j.id = c.judgment_id
          WHERE c.judgment_id = ?1
          ORDER BY c.pdf_page, c.paragraph_index, c.part_index
          LIMIT 500`,
      ).bind(judgmentId),
    );
    const queryResults = await env.DB.batch<ChunkRow>(statements);
    const contexts = queryResults.map((result, index) => {
      const chunks: Array<ChunkRow & {
        keyword_score: null;
        semantic_score: null;
        rrf_score: number;
      }> = [];
      let includedCharacters = 0;
      for (const chunk of result.results) {
        if (includedCharacters + chunk.chunk_text.length > maxCharacters) break;
        chunks.push({
          ...chunk,
          keyword_score: null,
          semantic_score: null,
          rrf_score: 0,
        });
        includedCharacters += chunk.chunk_text.length;
      }
      return {
        judgment_id: judgmentIds[index],
        chunks,
        truncated: chunks.length < result.results.length || result.results.length === 500,
        included_characters: includedCharacters,
      };
    });

    console.info(JSON.stringify({
      event: "judgment_context.complete",
      judgment_count: contexts.length,
      chunk_count: contexts.reduce((total, context) => total + context.chunks.length, 0),
      duration_ms: Math.round(performance.now() - startedAt),
    }));
    return jsonResponse(env, { contexts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Judgment context failed";
    console.error(JSON.stringify({ event: "judgment_context.error", message }));
    return jsonResponse(env, { error: message }, 400);
  }
}

async function citator(env: Env, request: Request): Promise<Response> {
  const startedAt = performance.now();
  let body: CitatorBody;
  try {
    body = (await request.json()) as CitatorBody;
  } catch {
    return jsonResponse(env, { error: "Request body must be valid JSON" }, 400);
  }

  try {
    const judgmentId = optionalText(body.judgment_id, 160);
    if (!judgmentId) throw new Error("judgment_id must be a non-empty string");
    const limit = integer(body.limit, 50, 1, 100);
    const reviewedOnly = body.reviewed_only === true;
    const result = await env.DB.prepare(
      `SELECT cm.id AS mention_id,
              cm.citing_judgment_id,
              j.title AS citing_title,
              j.citation AS citing_citation,
              j.decision_date AS citing_decision_date,
              cm.citing_chunk_id,
              cm.cited_case_name,
              cm.cited_reporter_citation,
              cm.pdf_page,
              cm.evidence_text AS mention_evidence,
              cm.resolution_status,
              cm.match_confidence,
              ct.treatment,
              ct.treatment_scope,
              ct.evidence_text AS treatment_evidence,
              ct.confidence AS treatment_confidence,
              ct.review_status
         FROM citation_mentions cm
         JOIN judgments j ON j.id = cm.citing_judgment_id
         LEFT JOIN citation_treatments ct ON ct.mention_id = cm.id
        WHERE cm.cited_judgment_id = ?1
          AND cm.resolution_status = 'resolved'
          AND (?2 = 0 OR ct.review_status = 'lawyer_reviewed')
        ORDER BY j.decision_date DESC, cm.pdf_page, cm.id
        LIMIT ?3`,
    )
      .bind(judgmentId, reviewedOnly ? 1 : 0, limit)
      .all<CitatorRow>();

    console.info(JSON.stringify({
      event: "citator.complete",
      result_count: result.results.length,
      reviewed_only: reviewedOnly,
      duration_ms: Math.round(performance.now() - startedAt),
    }));
    return jsonResponse(env, {
      judgment_id: judgmentId,
      reviewed_only: reviewedOnly,
      treatments: result.results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Citator lookup failed";
    console.error(JSON.stringify({ event: "citator.error", message }));
    return jsonResponse(env, { error: message }, 400);
  }
}

const BROWSE_SORTS = new Set(["relevance", "recent", "oldest", "title"]);
const BROWSE_MAX_PAGE_SIZE = 100;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function stringList(value: unknown, maxItems: number, itemMax = 160): string[] {
  if (!Array.isArray(value)) return [];
  const collected: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim().replace(/\s+/g, " ").slice(0, itemMax);
    if (trimmed) collected.push(trimmed);
    if (collected.length >= maxItems) break;
  }
  return [...new Set(collected)];
}

function optionalText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function optionalBench(value: unknown): number | null {
  return value === undefined || value === null ? null : integer(value, 1, 1, 50);
}

// Escapes LIKE wildcards so user input is matched literally (queries use ESCAPE '\').
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function browseFtsExpression(query: string): string | null {
  if (query.length < 2) return null;
  try {
    return ftsExpression(query);
  } catch {
    return null;
  }
}

function browseFacetBuckets(value: unknown): FacetBucket[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const bucket = item as Partial<FacetBucket>;
    const validValue = typeof bucket.value === "string" || typeof bucket.value === "number";
    return validValue && typeof bucket.count === "number" && Number.isInteger(bucket.count)
      ? [{ value: bucket.value as string | number, count: bucket.count }]
      : [];
  });
}

async function openSearchBrowse(
  env: Env,
  body: Record<string, unknown>,
): Promise<OpenSearchBrowseResult> {
  if (!env.OPENSEARCH_BROWSE_API_URL || !env.OPENSEARCH_API_TOKEN) {
    throw new Error("OpenSearch Browse is not configured");
  }
  const response = await fetch(openSearchApiUrl(env.OPENSEARCH_BROWSE_API_URL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENSEARCH_API_TOKEN}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(7_000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    results?: unknown;
    total?: unknown;
    facets?: unknown;
    error?: unknown;
  };
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : "OpenSearch Browse failed";
    throw new Error(`OpenSearch Browse gateway returned ${response.status}: ${message}`);
  }
  if (!Array.isArray(payload.results) || typeof payload.total !== "number") {
    throw new Error("OpenSearch Browse returned an invalid response");
  }
  const ids = payload.results.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const id = (item as { id?: unknown }).id;
    return typeof id === "string" && id.length <= 64 ? [id] : [];
  });
  const rawFacets = typeof payload.facets === "object" && payload.facets !== null
    ? payload.facets as Record<string, unknown>
    : {};
  const facets = {
    disposal_nature: browseFacetBuckets(rawFacets.disposal_nature),
    era: browseFacetBuckets(rawFacets.era),
    decision_year: browseFacetBuckets(rawFacets.decision_year),
    bench_size: browseFacetBuckets(rawFacets.bench_size),
    judges: browseFacetBuckets(rawFacets.judges),
  };
  return {
    ids,
    total: Number.isInteger(payload.total) && payload.total >= 0 ? payload.total : 0,
    facets: body.facets === true ? facets : undefined,
  };
}

const BROWSE_ROW_COLUMNS = `
  j.id, j.title, j.petitioner, j.respondent, j.citation, j.neutral_citation,
  j.cnr, j.case_number, j.court, j.decision_date, j.decision_year, j.disposal_nature,
  j.era, j.bench_size, j.available_languages, j.pdf_url, j.pdf_key`;

async function browseRowsByIds(env: Env, ids: string[]): Promise<JudgmentRow[]> {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  const result = await env.DB.prepare(
    `SELECT ${BROWSE_ROW_COLUMNS} FROM judgments j WHERE j.id IN (${placeholders})`,
  )
    .bind(...ids)
    .all<JudgmentRow>();
  const byId = new Map(result.results.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

async function browseSummaries(env: Env, rows: JudgmentRow[]) {
  const benchByJudgment = new Map<string, string[]>();
  if (rows.length) {
    const placeholders = rows.map(() => "?").join(",");
    const benchRows = await env.DB.prepare(
      `SELECT jj.judgment_id AS jid, jd.name AS name
         FROM judgment_judges jj JOIN judges jd ON jd.id = jj.judge_id
        WHERE jj.judgment_id IN (${placeholders})
        ORDER BY jj.judgment_id, jj.seat`,
    )
      .bind(...rows.map((row) => row.id))
      .all<{ jid: string; name: string }>();
    for (const entry of benchRows.results) {
      const list = benchByJudgment.get(entry.jid) ?? [];
      list.push(entry.name);
      benchByJudgment.set(entry.jid, list);
    }
  }

  return rows.map((row) => ({
    judgment_id: row.id,
    title: row.title,
    petitioner: row.petitioner,
    respondent: row.respondent,
    citation: row.citation,
    neutral_citation: row.neutral_citation,
    cnr: row.cnr,
    case_number: row.case_number,
    court: row.court,
    decision_date: row.decision_date,
    decision_year: row.decision_year,
    disposal_nature: row.disposal_nature,
    era: row.era,
    bench_size: row.bench_size,
    available_languages: (row.available_languages ?? "")
      .split(",")
      .map((code) => code.trim())
      .filter(Boolean),
    judges: benchByJudgment.get(row.id) ?? [],
    pdf_url: row.pdf_url,
    pdf_key: row.pdf_key,
  }));
}

async function browse(env: Env, request: Request): Promise<Response> {
  const startedAt = performance.now();
  let body: BrowseBody;
  try {
    body = (await request.json()) as BrowseBody;
  } catch {
    return jsonResponse(env, { error: "Request body must be valid JSON" }, 400);
  }

  try {
    const q = optionalText(body.q, 200);
    const party = optionalText(body.party, 160);
    const reporter = optionalText(body.reporter, 60);
    const neutralCitation = optionalText(body.neutral_citation, 60);
    const yearFrom = optionalYear(body.year_from);
    const yearTo = optionalYear(body.year_to);
    if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
      throw new Error("year_from must be less than or equal to year_to");
    }
    const dateFrom =
      typeof body.date_from === "string" && ISO_DATE.test(body.date_from) ? body.date_from : "";
    const dateTo =
      typeof body.date_to === "string" && ISO_DATE.test(body.date_to) ? body.date_to : "";
    const judges = stringList(body.judges, 20);
    const disposal = stringList(body.disposal, 40);
    const era = stringList(body.era, 10, 40);
    const language = stringList(body.language, 20, 8).map((code) => code.toUpperCase());
    const court = stringList(body.court, 10);
    const benchMin = optionalBench(body.bench_min);
    const benchMax = optionalBench(body.bench_max);
    if (benchMin !== null && benchMax !== null && benchMin > benchMax) {
      throw new Error("bench_min must be less than or equal to bench_max");
    }
    const sort =
      typeof body.sort === "string" && BROWSE_SORTS.has(body.sort)
        ? body.sort
        : q
          ? "relevance"
          : "recent";
    const pageSize = integer(body.page_size, 20, 1, BROWSE_MAX_PAGE_SIZE);
    const page = integer(body.page, 1, 1, 10_000);
    const wantFacets = body.facets === true;
    const offset = (page - 1) * pageSize;

    const ids = stringList(body.ids, 50, 64);
    const benchSizes = Array.isArray(body.bench)
      ? [...new Set(body.bench)].filter(
          (value): value is number => Number.isInteger(value) && value >= 1 && value <= 50,
        )
      : [];

    if (q && env.OPENSEARCH_BROWSE_API_URL && env.OPENSEARCH_API_TOKEN) {
      const openSearchStartedAt = performance.now();
      try {
        const openSearch = await openSearchBrowse(env, {
          q,
          ids,
          party,
          reporter,
          neutral_citation: neutralCitation,
          year_from: yearFrom,
          year_to: yearTo,
          date_from: dateFrom,
          date_to: dateTo,
          judges,
          disposal,
          era,
          language,
          court,
          bench: benchSizes,
          bench_min: benchMin,
          bench_max: benchMax,
          sort,
          page,
          page_size: pageSize,
          facets: wantFacets,
        });
        const rows = await browseRowsByIds(env, openSearch.ids);
        const results = await browseSummaries(env, rows);
        console.info(JSON.stringify({
          event: "browse.complete",
          backend: "opensearch",
          total: openSearch.total,
          page,
          page_size: pageSize,
          sort,
          facets: wantFacets,
          keyword_duration_ms: Math.round(performance.now() - openSearchStartedAt),
          duration_ms: Math.round(performance.now() - startedAt),
        }));
        return jsonResponse(env, {
          page,
          page_size: pageSize,
          total: openSearch.total,
          sort,
          results,
          ...(openSearch.facets ? { facets: openSearch.facets } : {}),
        });
      } catch (error) {
        console.warn(JSON.stringify({
          event: "browse.fallback",
          from: "opensearch",
          to: "d1",
          message: error instanceof Error ? error.message : "OpenSearch Browse unavailable",
        }));
      }
    }

    const conditions: string[] = [];
    const binds: unknown[] = [];
    if (ids.length) {
      conditions.push(`j.id IN (${ids.map(() => "?").join(",")})`);
      binds.push(...ids);
    }
    const ftsExpr = browseFtsExpression(q);
    const joinFts = ftsExpr !== null;
    if (ftsExpr !== null) {
      conditions.push("judgments_meta_fts MATCH ?");
      binds.push(ftsExpr);
    }
    if (party) {
      const pattern = `%${likeLiteral(party)}%`;
      conditions.push("(j.petitioner LIKE ? ESCAPE '\\' OR j.respondent LIKE ? ESCAPE '\\')");
      binds.push(pattern, pattern);
    }
    if (yearFrom !== null) {
      conditions.push("j.decision_year >= ?");
      binds.push(yearFrom);
    }
    if (yearTo !== null) {
      conditions.push("j.decision_year <= ?");
      binds.push(yearTo);
    }
    if (dateFrom) {
      conditions.push("j.decision_date >= ?");
      binds.push(dateFrom);
    }
    if (dateTo) {
      conditions.push("j.decision_date <= ?");
      binds.push(dateTo);
    }
    if (judges.length) {
      conditions.push(
        `EXISTS (SELECT 1 FROM judgment_judges jj JOIN judges jd ON jd.id = jj.judge_id
                  WHERE jj.judgment_id = j.id AND jd.name IN (${judges.map(() => "?").join(",")}))`,
      );
      binds.push(...judges);
    }
    if (disposal.length) {
      conditions.push(`j.disposal_nature IN (${disposal.map(() => "?").join(",")})`);
      binds.push(...disposal);
    }
    if (era.length) {
      conditions.push(`j.era IN (${era.map(() => "?").join(",")})`);
      binds.push(...era);
    }
    if (language.length) {
      conditions.push(
        "(" +
          language
            .map(() => "(',' || REPLACE(j.available_languages, ' ', '') || ',') LIKE ?")
            .join(" OR ") +
          ")",
      );
      binds.push(...language.map((code) => `%,${code},%`));
    }
    if (court.length) {
      conditions.push(`j.court IN (${court.map(() => "?").join(",")})`);
      binds.push(...court);
    }
    if (benchMin !== null) {
      conditions.push("j.bench_size >= ?");
      binds.push(benchMin);
    }
    if (benchMax !== null) {
      conditions.push("j.bench_size <= ?");
      binds.push(benchMax);
    }
    if (benchSizes.length) {
      conditions.push(`j.bench_size IN (${benchSizes.map(() => "?").join(",")})`);
      binds.push(...benchSizes);
    }
    if (reporter) {
      conditions.push("j.citation LIKE ? ESCAPE '\\'");
      binds.push(`%${likeLiteral(reporter)}%`);
    }
    if (neutralCitation) {
      conditions.push("j.neutral_citation LIKE ? ESCAPE '\\'");
      binds.push(`${likeLiteral(neutralCitation)}%`);
    }

    const fromSql = joinFts
      ? "FROM judgments j JOIN judgments_meta_fts ON judgments_meta_fts.rowid = j.rowid"
      : "FROM judgments j";
    const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const orderBy =
      sort === "relevance" && joinFts
        ? "bm25(judgments_meta_fts) ASC, j.decision_date DESC"
        : sort === "oldest"
          ? "j.decision_date ASC, j.id ASC"
          : sort === "title"
            ? "j.title ASC, j.id ASC"
            : "j.decision_date DESC, j.id ASC";

    const [countRow, pageResult] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) AS n ${fromSql} ${whereSql}`)
        .bind(...binds)
        .first<{ n: number }>(),
      env.DB.prepare(
        `SELECT ${BROWSE_ROW_COLUMNS}
           ${fromSql} ${whereSql}
          ORDER BY ${orderBy}
          LIMIT ? OFFSET ?`,
      )
        .bind(...binds, pageSize, offset)
        .all<JudgmentRow>(),
    ]);

    const rows = pageResult.results;
    const total = countRow?.n ?? 0;
    const results = await browseSummaries(env, rows);

    let facets: Record<string, FacetBucket[]> | undefined;
    if (wantFacets) {
      const groupFacet = (column: string, limit: number): Promise<D1Result<FacetBucket>> => {
        const guard = `${column} IS NOT NULL`;
        const clause = whereSql ? `${whereSql} AND ${guard}` : `WHERE ${guard}`;
        return env.DB.prepare(
          `SELECT ${column} AS value, COUNT(*) AS count ${fromSql} ${clause}
            GROUP BY value ORDER BY count DESC, value LIMIT ${limit}`,
        )
          .bind(...binds)
          .all<FacetBucket>();
      };
      const [disposalF, eraF, yearF, benchF, judgesF] = await Promise.all([
        groupFacet("j.disposal_nature", 40),
        groupFacet("j.era", 10),
        groupFacet("j.decision_year", 200),
        groupFacet("j.bench_size", 20),
        env.DB.prepare(
          `SELECT jd.name AS value, COUNT(*) AS count
             FROM judgment_judges jj JOIN judges jd ON jd.id = jj.judge_id
            WHERE jj.judgment_id IN (SELECT j.id ${fromSql} ${whereSql})
            GROUP BY value ORDER BY count DESC, value LIMIT 100`,
        )
          .bind(...binds)
          .all<FacetBucket>(),
      ]);
      facets = {
        disposal_nature: disposalF.results,
        era: eraF.results,
        decision_year: yearF.results,
        bench_size: benchF.results,
        judges: judgesF.results,
      };
    }

    console.info(
      JSON.stringify({
        event: "browse.complete",
        backend: "d1",
        total,
        page,
        page_size: pageSize,
        sort,
        facets: wantFacets,
        duration_ms: Math.round(performance.now() - startedAt),
      }),
    );
    return jsonResponse(env, {
      page,
      page_size: pageSize,
      total,
      sort,
      results,
      ...(facets ? { facets } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Browse failed";
    console.error(JSON.stringify({ event: "browse.error", message }));
    return jsonResponse(env, { error: message }, 400);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return jsonResponse(env, null, 204);
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse(env, {
        status: "ok",
        embedding_model: env.BGE_MODEL,
        embedding_pooling: env.EMBEDDING_POOLING,
      });
    }
    if (request.method === "POST" && url.pathname === "/api/search") {
      if (!(await isAuthorized(request, env))) {
        return jsonResponse(env, { error: "Unauthorized" }, 401);
      }
      return search(env, request);
    }
    if (request.method === "POST" && url.pathname === "/api/context") {
      if (!(await isAuthorized(request, env))) {
        return jsonResponse(env, { error: "Unauthorized" }, 401);
      }
      return judgmentContext(env, request);
    }
    if (request.method === "POST" && url.pathname === "/api/legal-search") {
      if (!(await isAuthorized(request, env))) {
        return jsonResponse(env, { error: "Unauthorized" }, 401);
      }
      return legalSearch(env, request);
    }
    if (request.method === "POST" && url.pathname === "/api/browse") {
      if (!(await isAuthorized(request, env))) {
        return jsonResponse(env, { error: "Unauthorized" }, 401);
      }
      return browse(env, request);
    }
    if (request.method === "POST" && url.pathname === "/api/citator") {
      if (!(await isAuthorized(request, env))) {
        return jsonResponse(env, { error: "Unauthorized" }, 401);
      }
      return citator(env, request);
    }
    return jsonResponse(env, { error: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
