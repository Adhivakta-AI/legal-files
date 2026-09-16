const MIN_YEAR = 1800;
const MAX_YEAR = 2200;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SORTS = new Set(["relevance", "recent", "oldest", "title"]);

function integer(value, fallback, min, max, name) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function optionalText(value, max, name) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").slice(0, max);
}

function strings(value, maxItems, maxLength, name) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  const result = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string") throw new Error(`${name} must contain strings`);
    const normalized = item.normalize("NFKC").trim().replace(/\s+/gu, " ").slice(0, maxLength);
    if (normalized && !seen.has(normalized)) {
      result.push(normalized);
      seen.add(normalized);
    }
    if (result.length >= maxItems) break;
  }
  return result;
}

function optionalYear(value, name) {
  return value === undefined || value === null
    ? null
    : integer(value, null, MIN_YEAR, MAX_YEAR, name);
}

function optionalBench(value, name) {
  return value === undefined || value === null ? null : integer(value, null, 1, 50, name);
}

function optionalDate(value, name) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || !ISO_DATE.test(value)) throw new Error(`${name} must be YYYY-MM-DD`);
  return value;
}

export function normalizeBrowseRequest(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Request body must be an object");
  }
  const q = optionalText(value.q, 200, "q");
  if (q.length < 2) throw new Error("q must contain at least 2 characters");
  const yearFrom = optionalYear(value.year_from, "year_from");
  const yearTo = optionalYear(value.year_to, "year_to");
  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
    throw new Error("year_from must be less than or equal to year_to");
  }
  const benchMin = optionalBench(value.bench_min, "bench_min");
  const benchMax = optionalBench(value.bench_max, "bench_max");
  if (benchMin !== null && benchMax !== null && benchMin > benchMax) {
    throw new Error("bench_min must be less than or equal to bench_max");
  }
  const page = integer(value.page, 1, 1, 10_000, "page");
  const pageSize = integer(value.page_size, 20, 1, 100, "page_size");
  return {
    q,
    ids: strings(value.ids, 50, 64, "ids"),
    party: optionalText(value.party, 160, "party"),
    reporter: optionalText(value.reporter, 60, "reporter"),
    neutralCitation: optionalText(value.neutral_citation, 60, "neutral_citation"),
    yearFrom,
    yearTo,
    dateFrom: optionalDate(value.date_from, "date_from"),
    dateTo: optionalDate(value.date_to, "date_to"),
    judges: strings(value.judges, 20, 160, "judges"),
    disposal: strings(value.disposal, 40, 160, "disposal"),
    era: strings(value.era, 10, 40, "era"),
    language: strings(value.language, 20, 8, "language").map((code) => code.toUpperCase()),
    court: strings(value.court, 10, 160, "court"),
    bench: Array.isArray(value.bench)
      ? [...new Set(value.bench.filter((item) => Number.isInteger(item) && item >= 1 && item <= 50))]
      : [],
    benchMin,
    benchMax,
    sort: typeof value.sort === "string" && SORTS.has(value.sort) ? value.sort : "relevance",
    page,
    pageSize,
    facets: value.facets === true,
  };
}

function escapedWildcard(value) {
  return value.toLocaleLowerCase().replace(/[\\*?]/g, "\\$&");
}

function termsFilter(field, values) {
  return values.length ? [{ terms: { [field]: values } }] : [];
}

function facet(field, size) {
  return { terms: { field, size, order: [{ _count: "desc" }, { _key: "asc" }] } };
}

export function buildBrowseBody(input) {
  const filters = [
    ...termsFilter("judgment_id", input.ids),
    ...termsFilter("judges", input.judges),
    ...termsFilter("disposal_nature", input.disposal),
    ...termsFilter("era", input.era),
    ...termsFilter("available_languages", input.language),
    ...termsFilter("court", input.court),
    ...termsFilter("bench_size", input.bench),
  ];
  if (input.yearFrom !== null || input.yearTo !== null) {
    filters.push({
      range: {
        decision_year: {
          ...(input.yearFrom === null ? {} : { gte: input.yearFrom }),
          ...(input.yearTo === null ? {} : { lte: input.yearTo }),
        },
      },
    });
  }
  if (input.dateFrom || input.dateTo) {
    filters.push({
      range: {
        decision_date: {
          ...(input.dateFrom ? { gte: input.dateFrom } : {}),
          ...(input.dateTo ? { lte: input.dateTo } : {}),
        },
      },
    });
  }
  if (input.benchMin !== null || input.benchMax !== null) {
    filters.push({
      range: {
        bench_size: {
          ...(input.benchMin === null ? {} : { gte: input.benchMin }),
          ...(input.benchMax === null ? {} : { lte: input.benchMax }),
        },
      },
    });
  }
  if (input.party) {
    const value = `*${escapedWildcard(input.party)}*`;
    filters.push({
      bool: {
        minimum_should_match: 1,
        should: [
          { wildcard: { "petitioner.exact": { value } } },
          { wildcard: { "respondent.exact": { value } } },
        ],
      },
    });
  }
  if (input.reporter) {
    filters.push({ wildcard: { "citation.exact": { value: `*${escapedWildcard(input.reporter)}*` } } });
  }
  if (input.neutralCitation) {
    filters.push({ prefix: { "neutral_citation.exact": escapedWildcard(input.neutralCitation) } });
  }

  const offset = (input.page - 1) * input.pageSize;
  const beyondWindow = offset >= 50_000;
  const sort =
    input.sort === "oldest"
      ? [{ decision_date: { order: "asc", missing: "_last" } }, { judgment_id: "asc" }]
      : input.sort === "title"
        ? [{ "title.sort": "asc" }, { judgment_id: "asc" }]
        : input.sort === "recent"
          ? [{ decision_date: { order: "desc", missing: "_last" } }, { judgment_id: "asc" }]
          : [{ _score: "desc" }, { decision_date: { order: "desc", missing: "_last" } }, { judgment_id: "asc" }];

  return {
    from: beyondWindow ? 0 : offset,
    size: beyondWindow ? 0 : input.pageSize,
    track_total_hits: true,
    _source: false,
    timeout: "6s",
    sort,
    query: {
      bool: {
        filter: filters,
        minimum_should_match: 1,
        should: [
          { match_phrase: { title: { query: input.q, boost: 18 } } },
          { multi_match: { query: input.q, fields: ["petitioner^12", "respondent^12", "citation^15", "neutral_citation^15", "case_number^15"], type: "phrase" } },
          { match_phrase: { text: { query: input.q, boost: 8 } } },
          { match_phrase: { text: { query: input.q, slop: 2, boost: 4 } } },
          { multi_match: { query: input.q, fields: ["title^5", "petitioner^4", "respondent^4", "citation^6", "neutral_citation^6", "case_number^6", "text^3"], operator: "and" } },
          { match: { text: { query: input.q, operator: "and", boost: 1.5 } } },
          { match: { "text.stemmed": { query: input.q, operator: "and", boost: 1 } } },
        ],
      },
    },
    ...(input.facets
      ? {
          aggs: {
            disposal_nature: facet("disposal_nature", 40),
            era: facet("era", 10),
            decision_year: facet("decision_year", 200),
            bench_size: facet("bench_size", 20),
            judges: facet("judges", 100),
          },
        }
      : {}),
  };
}

export function browseResponse(payload) {
  const hits = Array.isArray(payload?.hits?.hits) ? payload.hits.hits : [];
  const results = hits.flatMap((hit) =>
    typeof hit?._id === "string"
      ? [{ id: hit._id, score: typeof hit?._score === "number" ? hit._score : null }]
      : [],
  );
  const total = typeof payload?.hits?.total === "number"
    ? payload.hits.total
    : Number(payload?.hits?.total?.value ?? 0);
  const facets = {};
  for (const name of ["disposal_nature", "era", "decision_year", "bench_size", "judges"]) {
    const buckets = payload?.aggregations?.[name]?.buckets;
    if (Array.isArray(buckets)) {
      facets[name] = buckets.flatMap((bucket) =>
        (typeof bucket?.key === "string" || typeof bucket?.key === "number") && Number.isInteger(bucket?.doc_count)
          ? [{ value: bucket.key, count: bucket.doc_count }]
          : [],
      );
    }
  }
  return { results, total: Number.isFinite(total) ? total : 0, facets };
}
