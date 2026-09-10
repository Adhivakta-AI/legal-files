const MIN_YEAR = 1800;
const MAX_YEAR = 2200;

function integer(value, fallback, min, max, name) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function normalizeSearchRequest(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Request body must be an object");
  }
  if (typeof value.query !== "string") throw new Error("query must be a string");
  const query = value.query.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (query.length < 3 || query.length > 500) {
    throw new Error("query must be between 3 and 500 characters");
  }
  const yearFrom = integer(value.year_from, null, MIN_YEAR, MAX_YEAR, "year_from");
  const yearTo = integer(value.year_to, null, MIN_YEAR, MAX_YEAR, "year_to");
  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
    throw new Error("year_from must be less than or equal to year_to");
  }
  return {
    query,
    limit: integer(value.limit, 80, 1, 100, "limit"),
    yearFrom,
    yearTo,
  };
}

export function buildSearchBody({ query, limit, yearFrom, yearTo }) {
  const filters = [];
  if (yearFrom !== null || yearTo !== null) {
    filters.push({
      range: {
        decision_year: {
          ...(yearFrom === null ? {} : { gte: yearFrom }),
          ...(yearTo === null ? {} : { lte: yearTo }),
        },
      },
    });
  }

  return {
    size: limit,
    track_total_hits: false,
    _source: false,
    collapse: { field: "judgment_id" },
    timeout: "4s",
    query: {
      bool: {
        filter: filters,
        minimum_should_match: 1,
        should: [
          { match_phrase: { text: { query, boost: 8 } } },
          { match_phrase: { text: { query, slop: 2, boost: 4 } } },
          { match: { text: { query, operator: "and", boost: 3 } } },
          { match: { text: { query, minimum_should_match: "65%", boost: 1.5 } } },
          { match: { "text.stemmed": { query, minimum_should_match: "60%", boost: 1 } } },
        ],
      },
    },
  };
}
