interface Env {
  AI: Ai;
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  DOCUMENTS: R2Bucket;
  BGE_MODEL: string;
  EMBEDDING_POOLING: string;
  SEMANTIC_CANDIDATES: string;
  KEYWORD_CANDIDATES: string;
  RRF_K: string;
  CORS_ORIGIN: string;
}

interface SearchBody {
  query?: unknown;
  limit?: unknown;
  year_from?: unknown;
  year_to?: unknown;
}

interface Candidate {
  id: string;
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

async function keywordCandidates(
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

async function embedQuery(env: Env, query: string): Promise<number[]> {
  const output = (await env.AI.run(env.BGE_MODEL as keyof AiModels, {
    text: [query],
    pooling: env.EMBEDDING_POOLING,
  } as never)) as unknown as { data?: number[][] };
  const vector = output.data?.[0];
  if (!vector || vector.length !== 384) throw new Error("Workers AI returned an invalid embedding");
  return vector;
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
    if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
      throw new Error("year_from must be less than or equal to year_to");
    }

    const keywordLimit = integer(Number(env.KEYWORD_CANDIDATES), 80, 1, 100);
    const semanticLimit = integer(Number(env.SEMANTIC_CANDIDATES), 80, 1, 100);
    const [keywords, embedding] = await Promise.all([
      keywordCandidates(env, query, keywordLimit, yearFrom, yearTo),
      embedQuery(env, query),
    ]);
    const semanticResult = await env.VECTORIZE.query(embedding, {
      topK: semanticLimit,
      returnMetadata: "none",
      filter: vectorFilter(yearFrom, yearTo),
    });
    const semantics = semanticResult.matches.map((match) => ({ id: match.id, score: match.score }));

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

    const ranked = [...combined.entries()].sort((a, b) => b[1].rrf - a[1].rrf).slice(0, limit);
    const chunks = await fetchChunks(env, ranked.map(([id]) => id));
    const results = ranked.flatMap(([id, scores]) => {
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

    return jsonResponse(env, { query, limit, year_from: yearFrom, year_to: yearTo, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed";
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
      return search(env, request);
    }
    return jsonResponse(env, { error: "Not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
