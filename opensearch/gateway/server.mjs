import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import { browseResponse, buildBrowseBody, normalizeBrowseRequest } from "./browse-query.mjs";
import { buildSearchBody, normalizeSearchRequest } from "./search-query.mjs";

const port = Number.parseInt(process.env.PORT ?? "7711", 10);
const openSearchUrl = new URL(process.env.OPENSEARCH_URL ?? "http://127.0.0.1:9200");
const indexAlias = process.env.OPENSEARCH_INDEX_ALIAS ?? "judgment-chunks-current";
const browseIndexAlias = process.env.OPENSEARCH_BROWSE_INDEX_ALIAS ?? "judgments-current";
const gatewayToken = process.env.SEARCH_GATEWAY_TOKEN ?? "";
const MAX_BODY_BYTES = 16 * 1024;

if (!gatewayToken || gatewayToken.length < 32) {
  throw new Error("SEARCH_GATEWAY_TOKEN must contain at least 32 characters");
}
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT is invalid");

function send(response, status, body) {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(encoded),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(encoded);
}

function authorized(request) {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = createHash("sha256").update(header.slice(7)).digest();
  const expected = createHash("sha256").update(gatewayToken).digest();
  return timingSafeEqual(supplied, expected);
}

async function jsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

async function search(request, response) {
  const startedAt = performance.now();
  let input;
  try {
    input = normalizeSearchRequest(await jsonBody(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    return send(response, 400, { error: message });
  }

  try {
    const target = new URL(`${encodeURIComponent(indexAlias)}/_search`, openSearchUrl);
    const upstream = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildSearchBody(input)),
      signal: AbortSignal.timeout(4_500),
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error(JSON.stringify({ event: "opensearch.error", status: upstream.status }));
      return send(response, 502, { error: "Keyword index is unavailable" });
    }
    const hits = Array.isArray(payload?.hits?.hits) ? payload.hits.hits : [];
    const results = hits.flatMap((hit) =>
      typeof hit?._id === "string" && typeof hit?._score === "number"
        ? [{ id: hit._id, score: hit._score }]
        : [],
    );
    console.info(JSON.stringify({
      event: "keyword_search.complete",
      result_count: results.length,
      duration_ms: Math.round(performance.now() - startedAt),
      opensearch_took_ms: typeof payload?.took === "number" ? payload.took : null,
    }));
    return send(response, 200, { results });
  } catch (error) {
    console.error(JSON.stringify({
      event: "opensearch.unavailable",
      message: error instanceof Error ? error.message : "OpenSearch unavailable",
    }));
    return send(response, 502, { error: "Keyword index is unavailable" });
  }
}

async function browse(request, response) {
  const startedAt = performance.now();
  let input;
  try {
    input = normalizeBrowseRequest(await jsonBody(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request";
    return send(response, 400, { error: message });
  }

  try {
    const target = new URL(`${encodeURIComponent(browseIndexAlias)}/_search`, openSearchUrl);
    const upstream = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildBrowseBody(input)),
      signal: AbortSignal.timeout(6_500),
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error(JSON.stringify({ event: "opensearch_browse.error", status: upstream.status }));
      return send(response, 502, { error: "Browse index is unavailable" });
    }
    const result = browseResponse(payload);
    console.info(JSON.stringify({
      event: "browse_search.complete",
      result_count: result.results.length,
      total: result.total,
      duration_ms: Math.round(performance.now() - startedAt),
      opensearch_took_ms: typeof payload?.took === "number" ? payload.took : null,
    }));
    return send(response, 200, result);
  } catch (error) {
    console.error(JSON.stringify({
      event: "opensearch_browse.unavailable",
      message: error instanceof Error ? error.message : "OpenSearch unavailable",
    }));
    return send(response, 502, { error: "Browse index is unavailable" });
  }
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    return send(response, 200, { status: "ok" });
  }
  if (request.method !== "POST" || (request.url !== "/v1/keyword" && request.url !== "/v1/browse")) {
    return send(response, 404, { error: "Not found" });
  }
  if (!authorized(request)) return send(response, 401, { error: "Unauthorized" });
  return request.url === "/v1/browse" ? browse(request, response) : search(request, response);
});

server.requestTimeout = 7_000;
server.headersTimeout = 5_000;
server.listen(port, "0.0.0.0", () => {
  console.info(JSON.stringify({
    event: "gateway.started",
    port,
    index_alias: indexAlias,
    browse_index_alias: browseIndexAlias,
  }));
});
