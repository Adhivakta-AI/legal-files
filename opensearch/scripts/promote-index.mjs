const [url, indexName, alias = "judgment-chunks-current"] =
  process.argv.slice(2);
if (!indexName || !/^(?:judgment-chunks|judgments)-v[\w-]+$/.test(indexName)) {
  throw new Error("Usage: node promote-index.mjs <url> <judgment-chunks-v*|judgments-v*> [alias]");
}

const current = await fetch(new URL(`_alias/${encodeURIComponent(alias)}`, `${url}/`));
const currentPayload = current.ok ? await current.json() : {};
const oldIndexes = Object.keys(currentPayload);
const actions = [
  ...oldIndexes.map((index) => ({ remove: { index, alias } })),
  { add: { index: indexName, alias } },
];
const response = await fetch(new URL("_aliases", `${url}/`), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ actions }),
});
const payload = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(`Alias promotion failed (${response.status}): ${JSON.stringify(payload)}`);
console.log(JSON.stringify({ alias, index: indexName, replaced: oldIndexes }));
