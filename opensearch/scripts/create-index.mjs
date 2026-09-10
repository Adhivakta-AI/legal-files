import { readFile } from "node:fs/promises";

const [url, indexName] = process.argv.slice(2);
if (!indexName || !/^(?:judgment-chunks|judgments)-v[\w-]+$/.test(indexName)) {
  throw new Error("Usage: node create-index.mjs <url> <judgment-chunks-v*|judgments-v*>");
}
const templateUrl = new URL(
  indexName.startsWith("judgments-v") ? "../judgment-index-template.json" : "../index-template.json",
  import.meta.url,
);
const template = JSON.parse(await readFile(templateUrl, "utf8"));
const response = await fetch(new URL(encodeURIComponent(indexName), `${url}/`), {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(template),
});
const payload = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(`Index creation failed (${response.status}): ${JSON.stringify(payload)}`);
console.log(JSON.stringify({ index: indexName, acknowledged: payload.acknowledged === true }));
