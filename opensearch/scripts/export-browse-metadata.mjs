import { createWriteStream } from "node:fs";
import { once } from "node:events";

const [outputPath] = process.argv.slice(2);
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const apiToken = process.env.CLOUDFLARE_API_TOKEN ?? "";
const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID ?? "";
const PAGE_SIZE = 2_000;

if (!outputPath) throw new Error("Usage: node export-browse-metadata.mjs <output.jsonl>");
if (!accountId || !apiToken || !databaseId) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and CLOUDFLARE_D1_DATABASE_ID are required");
}

const queryUrl =
  `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}` +
  `/d1/database/${encodeURIComponent(databaseId)}/query`;

async function query(sql, params, attempts = 6) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(queryUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(60_000),
    });
    const payload = await response.json().catch(() => ({}));
    const result = payload?.result?.[0];
    if (response.ok && payload.success === true && result?.success !== false) {
      return Array.isArray(result?.results) ? result.results : [];
    }
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === attempts - 1) {
      throw new Error(`D1 query failed (${response.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 15_000)));
  }
  throw new Error("D1 query failed");
}

const sql = `
  SELECT j.id AS judgment_id, j.title, j.petitioner, j.respondent, j.citation,
         j.neutral_citation, j.cnr, j.decision_date, j.decision_year,
         j.case_number,
         j.disposal_nature, j.available_languages, j.era, j.bench_size, j.court,
         COALESCE((
           SELECT json_group_array(name)
             FROM (
               SELECT jd.name AS name
                 FROM judgment_judges jj
                 JOIN judges jd ON jd.id = jj.judge_id
                WHERE jj.judgment_id = j.id
                ORDER BY jj.seat
             )
         ), '[]') AS judges_json
    FROM judgments j
   WHERE j.id > ?
   ORDER BY j.id
   LIMIT ?`;

const output = createWriteStream(outputPath, { encoding: "utf8", mode: 0o600 });
let lastId = "";
let exported = 0;
try {
  while (true) {
    const rows = await query(sql, [lastId, PAGE_SIZE]);
    if (!rows.length) break;
    for (const row of rows) {
      let judges = [];
      try {
        const parsed = JSON.parse(row.judges_json ?? "[]");
        if (Array.isArray(parsed)) judges = parsed.filter((value) => typeof value === "string");
      } catch {
        judges = [];
      }
      const document = { ...row, judges };
      delete document.judges_json;
      if (!output.write(`${JSON.stringify(document)}\n`)) await once(output, "drain");
    }
    exported += rows.length;
    lastId = String(rows.at(-1).judgment_id);
    console.log(JSON.stringify({ event: "metadata_export.progress", exported, last_id: lastId }));
    if (rows.length < PAGE_SIZE) break;
  }
} finally {
  output.end();
  await once(output, "finish");
}
console.log(JSON.stringify({ event: "metadata_export.complete", exported, output: outputPath }));
