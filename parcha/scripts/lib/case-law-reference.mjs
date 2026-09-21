export const CASE_LAW_TREATMENTS = [
  "not followed",
  "referred to",
  "relied on",
  "followed",
  "distinguished",
  "overruled",
  "disapproved",
  "approved",
  "affirmed",
  "applied",
  "explained",
  "considered",
  "cited",
]

const treatmentPattern = new RegExp(
  `\\b(${CASE_LAW_TREATMENTS.join("|").replaceAll(" ", "\\s+")})\\b`,
  "gi"
)
const reportedYearPattern = String.raw`(?:18|19|20)\d{2}`
const reporterPattern = String.raw`(?:S\.?\s*C\.?\s*R\.?|S\.?\s*C\.?\s*C\.?)`
const citationPattern = new RegExp(
  String.raw`^(?:` +
    String.raw`(?:\[\s*${reportedYearPattern}\s*\]|\(\s*${reportedYearPattern}\s*\))\s*(?:` +
    String.raw`(?:\d+\s+)?(?:Supp(?:l)?\.?\s+)?${reporterPattern}(?:\s*\([^)]+\))?\s+\d+` +
    String.raw`|SCC\s+OnLine(?:\s+[A-Za-z.]+)?\s+\d+` +
    String.raw`)` +
    String.raw`|AIR\s+${reportedYearPattern}\s+[A-Za-z.]+\s+\d+` +
    String.raw`|${reportedYearPattern}\s+SCC\s+OnLine(?:\s+[A-Za-z.]+)?\s+\d+` +
    String.raw`|${reportedYearPattern}\s+INSC\s+\d+` +
    String.raw`)$`,
  "iu"
)
const paragraphNumberPattern = String.raw`\d+[A-Za-z]?(?:\([A-Za-z0-9]+\))?`
const pinpointPattern = new RegExp(
  String.raw`^Para(?:graph)?s?\.?\s+${paragraphNumberPattern}` +
    String.raw`(?:\s*(?:(?:[-–—,]|and|to)\s*)${paragraphNumberPattern})*$`,
  "iu"
)
const headingPattern = /^Case\s+Law\s+References?$/i
const sectionBoundaryPattern =
  /^(?:(?:CIVIL|CRIMINAL)\s+(?:ORIGINAL|APPELLATE|EXTRAORDINARY)\s+JURISDICTION\b|JUDGMENTS?\b|ORDERS?\b|The\s+(?:Judgment|Order)\s+of\s+the\s+Court\b|Appearances?\b)/i

function normalizeSpaces(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeTreatment(value) {
  return normalizeSpaces(value).toLocaleLowerCase("en")
}

function boundsFor(elements) {
  if (!elements.length) return null
  return {
    top: Math.min(...elements.map((element) => element.top)),
    bottom: Math.max(
      ...elements.map((element) => element.top + element.height)
    ),
    left: Math.min(...elements.map((element) => element.left)),
    right: Math.max(...elements.map((element) => element.left + element.width)),
  }
}

function groupVisualLines(elements, tolerance = 0.3) {
  const ordered = [...elements].sort((a, b) => a.top - b.top || a.left - b.left)
  const lines = []
  for (const element of ordered) {
    const line = lines.at(-1)
    if (line && Math.abs(line.top - element.top) <= tolerance) {
      line.elements.push(element)
      line.top =
        line.elements.reduce((sum, entry) => sum + entry.top, 0) /
        line.elements.length
    } else {
      lines.push({ top: element.top, elements: [element] })
    }
  }
  return lines.map((line) => ({
    ...line,
    elements: line.elements.sort((a, b) => a.left - b.left),
  }))
}

function gutterFurnitureIds(page) {
  const edgeCandidates = page.elements.filter((element) => {
    const edgeBand = page.width * 0.25
    return (
      /^[A-H]$/.test(element.text.trim()) &&
      (element.left < edgeBand || element.left > page.width - edgeBand)
    )
  })
  const clusters = []
  const horizontalTolerance = Math.max(3, page.width * 0.008)

  for (const element of [...edgeCandidates].sort((a, b) => a.left - b.left)) {
    const cluster = clusters.find(
      (candidate) =>
        Math.abs(candidate.left - element.left) <= horizontalTolerance
    )
    if (cluster) {
      cluster.elements.push(element)
      cluster.left =
        cluster.elements.reduce((sum, entry) => sum + entry.left, 0) /
        cluster.elements.length
    } else {
      clusters.push({ left: element.left, elements: [element] })
    }
  }

  return new Set(
    clusters
      .filter((cluster) => {
        const distinctMarkers = new Set(
          cluster.elements.map((element) => element.text.trim())
        ).size
        const verticalRange =
          Math.max(...cluster.elements.map((element) => element.top)) -
          Math.min(...cluster.elements.map((element) => element.top))
        return distinctMarkers >= 4 && verticalRange >= page.height * 0.25
      })
      .flatMap((cluster) => cluster.elements.map((element) => element.id))
  )
}

export function parseCaseLawReferenceLine(text) {
  const value = normalizeSpaces(text)
  const treatments = [...value.matchAll(treatmentPattern)]
  if (treatments.length !== 1) return null

  const match = treatments[0]
  const citation = normalizeSpaces(value.slice(0, match.index))
  const treatment = normalizeTreatment(match[0])
  const pinpoint = normalizeSpaces(
    value.slice((match.index ?? 0) + match[0].length)
  )
  if (!citationPattern.test(citation) || !pinpointPattern.test(pinpoint))
    return null

  return {
    citation,
    treatment,
    pinpoint: pinpoint
      .replace(/^paragraphs?/i, "Para")
      .replace(/^paras?/i, "Para"),
    paragraphRefs: [...pinpoint.matchAll(/\d+/g)].map((entry) =>
      Number(entry[0])
    ),
  }
}

function splitVisualCells(elements, parsed) {
  for (
    let treatmentStart = 1;
    treatmentStart < elements.length - 1;
    treatmentStart += 1
  ) {
    for (
      let pinpointStart = treatmentStart + 1;
      pinpointStart < elements.length;
      pinpointStart += 1
    ) {
      const citationElements = elements.slice(0, treatmentStart)
      const treatmentElements = elements.slice(treatmentStart, pinpointStart)
      const pinpointElements = elements.slice(pinpointStart)
      const citation = normalizeSpaces(
        citationElements.map((element) => element.text).join(" ")
      )
      const treatment = normalizeTreatment(
        treatmentElements.map((element) => element.text).join(" ")
      )
      const pinpoint = normalizeSpaces(
        pinpointElements.map((element) => element.text).join(" ")
      )

      if (
        citation === parsed.citation &&
        treatment === parsed.treatment &&
        pinpointPattern.test(pinpoint)
      ) {
        return { citationElements, treatmentElements, pinpointElements }
      }
    }
  }
  return null
}

function visualRowFromLine(page, line) {
  const elements = line.elements
  if (elements.length < 3) return null
  const text = elements.map((element) => element.text).join(" ")
  const parsed = parseCaseLawReferenceLine(text)
  if (!parsed) return null

  const cells = splitVisualCells(elements, parsed)

  return {
    citation: parsed.citation,
    treatment: parsed.treatment,
    pinpoint: parsed.pinpoint,
    paragraphRefs: parsed.paragraphRefs,
    sourcePage: page.number,
    top: line.top,
    bounds: boundsFor(elements),
    cellBounds: cells
      ? {
          citation: boundsFor(cells.citationElements),
          treatment: boundsFor(cells.treatmentElements),
          pinpoint: boundsFor(cells.pinpointElements),
        }
      : null,
    sourceChunkIds: [],
    confidence: cells ? 1 : 0.9,
  }
}

function stableThreeColumnGeometry(rows) {
  const exact = rows.filter((row) => row.cellBounds)
  if (exact.length < Math.min(3, rows.length)) return false
  const deltas = exact.map((row) => ({
    treatment: row.cellBounds.treatment.left - row.cellBounds.citation.left,
    pinpoint: row.cellBounds.pinpoint.left - row.cellBounds.treatment.left,
  }))
  const treatmentRange =
    Math.max(...deltas.map((entry) => entry.treatment)) -
    Math.min(...deltas.map((entry) => entry.treatment))
  const pinpointRange =
    Math.max(...deltas.map((entry) => entry.pinpoint)) -
    Math.min(...deltas.map((entry) => entry.pinpoint))
  return treatmentRange <= 3 && pinpointRange <= 3
}

function rowChunkIds(row, blocks) {
  const candidates = blocks.filter((block) => {
    const bounds = block.typography?.bounds
    return (
      block.sourcePage === row.sourcePage &&
      bounds &&
      bounds.top <= row.top + 0.75 &&
      bounds.bottom >= row.top - 0.75
    )
  })
  return [...new Set(candidates.flatMap((block) => block.sourceChunkIds ?? []))]
}

export function extractCaseLawReferenceTables(pdf, blocks = []) {
  const pageCandidates = [...pdf.pages.values()]
    .sort((a, b) => a.number - b.number)
    .map((page) => {
      const gutterIds = gutterFurnitureIds(page)
      const lines = groupVisualLines(
        page.elements.filter((element) => !gutterIds.has(element.id))
      )
      const headings = lines.filter((line) =>
        headingPattern.test(
          normalizeSpaces(line.elements.map((entry) => entry.text).join(" "))
        )
      )
      const heading = headings[0] ?? null
      const boundary = lines.find(
        (line) =>
          (!heading || line.top > heading.top) &&
          sectionBoundaryPattern.test(
            normalizeSpaces(line.elements.map((entry) => entry.text).join(" "))
          )
      )
      const rows = lines
        .map((line) => visualRowFromLine(page, line))
        .filter(
          (row) =>
            row &&
            (!heading || row.top > heading.top) &&
            (!boundary || row.top < boundary.top)
        )
      return {
        page: page.number,
        rows,
        headingBounds: heading ? boundsFor(heading.elements) : null,
        stableColumns: stableThreeColumnGeometry(rows),
        rowsNearTop: Boolean(rows.length && rows[0].top <= page.height * 0.4),
      }
    })

  const tables = []
  let current = null
  for (const candidate of pageCandidates) {
    const canStart =
      candidate.stableColumns &&
      ((candidate.headingBounds && candidate.rows.length >= 2) ||
        (!candidate.headingBounds &&
          candidate.rows.length >= 8 &&
          candidate.rowsNearTop))
    const canContinue =
      current &&
      candidate.page === current.sourcePages.at(-1) + 1 &&
      candidate.rows.length > 0 &&
      candidate.stableColumns &&
      candidate.rowsNearTop

    if (canStart || canContinue) {
      if (!current) {
        current = {
          id: `case-law-reference-p${String(candidate.page).padStart(4, "0")}`,
          role: "case_law_reference",
          title: "Case Law Reference",
          sourcePages: [],
          sourceChunkIds: [],
          headingBounds: candidate.headingBounds,
          rows: [],
        }
      }
      current.sourcePages.push(candidate.page)
      current.rows.push(...candidate.rows)
      continue
    }

    if (current) {
      tables.push(current)
      current = null
    }
  }
  if (current) tables.push(current)

  return tables.map((table) => {
    const rows = table.rows.map((row) => ({
      ...row,
      sourceChunkIds: rowChunkIds(row, blocks),
    }))
    const sourceChunkIds = [
      ...new Set(rows.flatMap((row) => row.sourceChunkIds)),
    ]
    return {
      ...table,
      rows,
      sourceChunkIds,
      rowCount: rows.length,
      provenanceCoverage: rows.length
        ? rows.filter((row) => row.sourceChunkIds.length).length / rows.length
        : 0,
      confidence: rows.length
        ? rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length
        : 0,
    }
  })
}

export function caseLawReferenceTreatmentTotals(rows) {
  const totals = {}
  for (const row of rows)
    totals[row.treatment] = (totals[row.treatment] ?? 0) + 1
  return totals
}
