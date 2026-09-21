import { execFileSync } from "node:child_process"
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, extname, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { mkdtemp } from "node:fs/promises"
import { parseReadingCopyInput } from "./lib/reading-copy-source.mjs"
import { findJudgmentStart } from "./lib/poppler-layout.mjs"

const args = process.argv.slice(2)
const inputArg = args.find((arg) => !arg.startsWith("--"))
const outputFlagIndex = args.indexOf("--output")
const htmlFlagIndex = args.indexOf("--html")

if (!inputArg) {
  throw new Error(
    "Usage: node scripts/generate-reading-copy-pdf.mjs INPUT.{md,json} [--output OUTPUT.pdf] [--html OUTPUT.html]"
  )
}

const inputPath = resolve(inputArg)
const defaultStem = basename(inputPath, extname(inputPath))
const outputPath = resolve(
  outputFlagIndex >= 0 && args[outputFlagIndex + 1]
    ? args[outputFlagIndex + 1]
    : `reading-copy-data/generated/${defaultStem}.pdf`
)
const explicitHtmlPath =
  htmlFlagIndex >= 0 && args[htmlFlagIndex + 1]
    ? resolve(args[htmlFlagIndex + 1])
    : null

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function isSourceFurniture(block, metadata) {
  if (block.label !== "Unnumbered passage" || block.text.length > 190)
    return false
  if (/\bSUPREME\s+COURT(?:\s*\[\d{4}\])?\s*REPORTS?/i.test(block.text))
    return true

  const titleWords = String(metadata.title ?? "")
    .replace(/\b(?:versus|v\.?|and|another|others?)\b/gi, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4)
    .slice(0, 3)
  const titleMatches = titleWords.filter((word) =>
    block.text.toLocaleLowerCase().includes(word.toLocaleLowerCase())
  ).length

  return titleMatches >= 2 && /\b\d{1,4}(?:\s+\[[^\]]+\])?\s*$/.test(block.text)
}

function paragraphNumber(block) {
  const match = /^Paragraph\s+(.+)$/i.exec(block.label)
  return match?.[1]?.trim() ?? null
}

function withoutLeadingParagraphNumber(text, number) {
  if (!number) return text
  const escaped = number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return text.replace(
    new RegExp(`^\\s*(?:\\[\\s*)?${escaped}(?:\\s*\\])?[.)]?\\s+`),
    ""
  )
}

function dateLabel(value) {
  if (!value) return "Date not supplied"
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date)
}

function splitCaseTitle(title) {
  const value = String(title ?? "")
  const match = /^(.*?)\s+(?:versus|v\.?)\s+(.*)$/i.exec(value)
  return match ? { petitioner: match[1], respondent: match[2] } : null
}

function isFrontMatterDuplicate(block, metadata) {
  if (block.sourcePage !== 1 || block.text.length > 220) return false
  const normalized = block.text
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toLocaleLowerCase()
  const known = [
    metadata.title,
    metadata.petitioner,
    metadata.respondent,
    metadata.case_number,
    ...(Array.isArray(metadata.judges) ? metadata.judges : []),
  ]
    .filter(Boolean)
    .map((value) =>
      String(value)
        .replace(/[^A-Za-z0-9]+/g, " ")
        .trim()
        .toLocaleLowerCase()
    )

  if (
    known.some(
      (value) =>
        value.length >= 8 &&
        (normalized === value || value.includes(normalized))
    )
  ) {
    return true
  }
  return (
    /^\(?miscellaneous application no\b/i.test(block.text) ||
    /^\(writ petition\b/i.test(block.text) ||
    /^\[[^\]]+\bjj?\.?\]$/i.test(block.text)
  )
}

function looksLikeFootnote(text) {
  return (
    /^\d{1,3}\s+(?:\(\d{4}\)|AIR\s+\d{4}|[A-Z][A-Za-z.]+\s+v\.)/.test(text) ||
    /^\*+\s*/.test(text)
  )
}

function looksLikeExtract(text) {
  return (
    /^[“"‘']/.test(text) ||
    /^\(?[ivxlcdm]+\)[.)]?\s+/i.test(text) ||
    /^\(\d+\)\s+/.test(text)
  )
}

/** The first plausible reporter paragraph number, ignoring OCR noise like years. */
function firstParagraphNumber(blocks) {
  for (const block of blocks) {
    const supplied = paragraphNumber(block)
    if (supplied && /^\d{1,3}$/.test(supplied)) {
      const value = Number.parseInt(supplied, 10)
      if (value >= 1 && value <= 300) return value
    }
  }
  return null
}

function logicalJudgmentParagraphs(blocks) {
  const paragraphs = []
  let current = null
  // Reporter numbering does not always start at 1: OCR drops the opening
  // paragraph, or the reporter itself begins at 2. Hardcoding 1 meant `current`
  // never opened for those judgments and the body rendered empty.
  let expected = firstParagraphNumber(blocks) ?? 1

  for (const block of blocks) {
    const supplied = paragraphNumber(block)
    const numeric =
      supplied && /^\d{1,3}$/.test(supplied)
        ? Number.parseInt(supplied, 10)
        : null

    if (numeric === expected) {
      if (current) paragraphs.push(current)
      current = {
        number: numeric,
        segments: [
          {
            kind: "body",
            text: withoutLeadingParagraphNumber(block.text, supplied),
          },
        ],
        footnotes: [],
        sourcePages: new Set([block.sourcePage]),
        chunkIds: [...block.sourceChunkIds],
      }
      expected += 1
      continue
    }

    if (!current) continue
    current.sourcePages.add(block.sourcePage)
    current.chunkIds.push(...block.sourceChunkIds)
    if (looksLikeFootnote(block.text)) current.footnotes.push(block.text)
    else if (numeric !== null || looksLikeExtract(block.text)) {
      current.segments.push({ kind: "extract", text: block.text })
    } else {
      const previous = current.segments.at(-1)
      if (previous) previous.text = `${previous.text} ${block.text}`
      else current.segments.push({ kind: "body", text: block.text })
    }
  }

  if (current) paragraphs.push(current)
  return paragraphs
}

/**
 * Removes a reporter running header that the chunker folded into the start of a
 * page block, e.g. "838 SUPREME COURT REPORTS [1996] SUPP. 3 S.C.R." or
 * "KUPPUSAMY v. AUTHORISED OFFICER [K. VENKATASWAML, J.]839". Deliberately
 * conservative: it only strips when a recognisable header shape is followed by
 * substantial remaining text, so body prose is never eaten.
 */
function stripRunningHeader(text) {
  const patterns = [
    // "100 SUPREME COURT REPORTS [1994] SUPP. 6 S.C.R" — the trailing volume and
    // reporter abbreviation have to go too, or they head the rendered paragraph.
    /^\s*\d{1,4}\s+SUPREME\s+COURT\s+REPORTS\s*\[[^\]]{0,40}\]\s*(?:SUPP\.?\s*)?(?:\d{1,3}\s*)?(?:S\.?\s?C\.?\s?R\.?)?\s*/i,
    /^\s*.{0,90}?\sv\.?\s.{0,90}?\[[^\]]{0,60}\]\s*\d{1,4}\s+/,
    /^\s*.{0,70}?\sv\.?\s.{0,70}?\s\d{1,4}\s+/,
  ]
  for (const pattern of patterns) {
    const stripped = text.replace(pattern, "")
    if (stripped.length >= 200 && stripped !== text) return stripped.trimStart()
  }
  return text
}

function unnumberedJudgmentParagraphs(blocks) {
  return blocks
    .filter((block) => block.sourcePage >= 2)
    .map((block) => {
      const text = stripRunningHeader(block.text ?? "").trim()
      if (!text) return null
      return {
        number: null,
        segments: [{ kind: "body", text }],
        footnotes: [],
        sourcePages: new Set([block.sourcePage]),
        chunkIds: [...(block.sourceChunkIds ?? [])],
      }
    })
    .filter(Boolean)
}

function judgmentParagraphMarkup(paragraph) {
  const pages = [...paragraph.sourcePages]
  const chunks = paragraph.chunkIds.join(",")
  const [first, ...rest] = paragraph.segments
  const body = first?.text.replace(/\s+/g, " ").trim() ?? ""
  const numberMarkup =
    paragraph.number === null
      ? ""
      : `<span class="paragraph-number">${paragraph.number}.</span>`
  return `<div class="judgment-paragraph"${paragraph.number === null ? ' data-unnumbered="true"' : ""} data-source-pages="${pages.join(",")}" data-source-chunks="${escapeHtml(chunks)}">
    <p>${numberMarkup}${escapeHtml(body)}</p>
    ${rest.map((segment) => (segment.kind === "extract" ? `<blockquote>${escapeHtml(segment.text)}</blockquote>` : `<p class="continuation">${escapeHtml(segment.text)}</p>`)).join("\n")}
    ${paragraph.footnotes.length ? `<div class="footnotes">${paragraph.footnotes.map((text) => `<p>${escapeHtml(text)}</p>`).join("")}</div>` : ""}
  </div>`
}

function typographyClass(block) {
  const typography = block.typography
  if (
    !typography ||
    typography.coverage < 0.75 ||
    typography.stylePurity < 0.9
  ) {
    return null
  }
  if (typography.dominantStyle === "italic") return "source-italic"
  if (typography.dominantStyle === "bold") return "source-bold"
  if (typography.dominantStyle === "bold-italic") return "source-bold-italic"
  return null
}

function styledBlockText(block) {
  const typography = block.typography
  const wholeBlockClass = typographyClass(block)
  if (
    wholeBlockClass ||
    !typography ||
    typography.coverage < 0.75 ||
    !Array.isArray(typography.styleRuns)
  ) {
    return escapeHtml(block.text)
  }

  const runs = typography.styleRuns
    .filter(
      (run) =>
        Number.isInteger(run.start) &&
        Number.isInteger(run.end) &&
        run.start >= 0 &&
        run.end > run.start &&
        run.end <= block.text.length
    )
    .sort((a, b) => a.start - b.start || a.end - b.end)

  let cursor = 0
  const output = []
  for (const run of runs) {
    if (run.start < cursor) continue
    output.push(escapeHtml(block.text.slice(cursor, run.start)))
    const content = escapeHtml(block.text.slice(run.start, run.end))
    if (run.style === "bold-italic")
      output.push(`<strong><em>${content}</em></strong>`)
    else if (run.style === "bold") output.push(`<strong>${content}</strong>`)
    else if (run.style === "italic") output.push(`<em>${content}</em>`)
    else output.push(content)
    cursor = run.end
  }
  output.push(escapeHtml(block.text.slice(cursor)))
  return output.join("")
}

function digestBlockMarkup(block) {
  const classes = ["digest-block"]
  if (block.isLead) classes.push("lead")
  if (block.role) classes.push(`role-${block.role}`)
  const sourceStyle = typographyClass(block)
  if (sourceStyle) classes.push(sourceStyle)
  if (
    /\b(?:Advs?\.? for the appearing parties|Applicant-in-person|for the petitioner|for the respondent)\b/i.test(
      block.text
    )
  ) {
    classes.push("appearance")
  }
  const sourcePages = block.sourcePages ?? [block.sourcePage]
  const confidence = block.typography?.coverage
  const confidenceAttribute = Number.isFinite(confidence)
    ? ` data-layout-confidence="${confidence.toFixed(4)}"`
    : ""
  return `<p class="${classes.join(" ")}" data-source-pages="${sourcePages.join(",")}" data-source-chunks="${escapeHtml(block.sourceChunkIds.join(","))}"${confidenceAttribute}>${styledBlockText(block)}</p>`
}

function caseLawReferenceTableMarkup(table) {
  const rows = Array.isArray(table.rows) ? table.rows : []
  return `<section class="case-law-reference-section" data-case-law-reference-table="${escapeHtml(table.id)}" data-row-count="${rows.length}">
    <table class="case-law-reference-table">
      <colgroup>
        <col class="case-reference-citation-column">
        <col class="case-reference-treatment-column">
        <col class="case-reference-pinpoint-column">
      </colgroup>
      <thead>
        <tr><th colspan="3">${escapeHtml(table.title ?? "Case Law Reference")}</th></tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (
              row
            ) => `<tr data-case-reference-row data-source-page="${row.sourcePage}" data-source-chunks="${escapeHtml((row.sourceChunkIds ?? []).join(","))}">
          <td>${escapeHtml(row.citation)}</td>
          <td>${escapeHtml(row.treatment)}</td>
          <td>${escapeHtml(row.pinpoint)}</td>
        </tr>`
          )
          .join("\n")}
      </tbody>
    </table>
  </section>`
}

function endsSentence(text) {
  return /[.!?][”’"')\]]*\s*$/.test(text)
}

function startsAsContinuation(text) {
  return /^[a-zà-öø-ÿ,;:–—)\]]/.test(text.trim())
}

function looksLikeHeadnoteStart(text) {
  const value = text.trim()
  const dashCount = (value.match(/[–—]/g) ?? []).length
  return (
    /^[A-Z][^:\n]{2,100}:\s+/.test(value) ||
    /\bHeld\s*:/i.test(value) ||
    (value.length >= 180 && dashCount >= 2)
  )
}

function isHeadnoteBoundary(text) {
  const value = text.trim()
  if (
    /^(?:Cases? Referred|Appearances?|Civil\s+(?:Original|Appellate)|Criminal\s+(?:Original|Appellate)|Judgment|Order)\b/i.test(
      value
    )
  ) {
    return true
  }
  if (/^[A-Z][^:\n]{2,100}:\s+/.test(value)) return true
  return (
    /\bv\.?\s+.+\b(?:SCC|S\.C\.C\.|SCR|S\.C\.R\.|AIR)\b/i.test(value) &&
    /\b(?:relied on|referred to|followed|distinguished|overruled)\b/i.test(
      value
    )
  )
}

function mergeTypography(left, right) {
  if (!left || !right) return left ?? right ?? null
  const leftMatches = left.matchedTokenCount ?? 0
  const rightMatches = right.matchedTokenCount ?? 0
  const totalMatches = leftMatches + rightMatches
  const queryTokenCount =
    (left.queryTokenCount ?? 0) + (right.queryTokenCount ?? 0)
  const styleCounts = { ...(left.styleCounts ?? {}) }
  for (const [style, count] of Object.entries(right.styleCounts ?? {})) {
    styleCounts[style] = (styleCounts[style] ?? 0) + count
  }
  const orderedStyles = Object.entries(styleCounts).sort((a, b) => b[1] - a[1])
  return {
    ...left,
    queryTokenCount,
    matchedTokenCount: totalMatches,
    coverage: totalMatches / Math.max(1, queryTokenCount),
    dominantStyle: orderedStyles[0]?.[0] ?? left.dominantStyle,
    stylePurity: totalMatches ? (orderedStyles[0]?.[1] ?? 0) / totalMatches : 0,
    styleCounts,
    styleRuns: [],
  }
}

function mergeHeadnoteContinuations(blocks) {
  if (!blocks.length) return blocks

  const start = blocks.findIndex(
    (block) => block.role === "headnote" || looksLikeHeadnoteStart(block.text)
  )
  if (start < 0) return blocks

  const prepared = blocks.map((block, index) => ({
    ...block,
    isLead: index === start,
    sourcePages: [...(block.sourcePages ?? [block.sourcePage])],
    sourceChunkIds: [...block.sourceChunkIds],
  }))
  const mergedBlocks = []

  for (const block of prepared) {
    const previous = mergedBlocks.at(-1)
    const crossesStructuredBoundary =
      previous?.role === "case_reference_source" ||
      block.role === "case_reference_source"
    const bothHeadnotes =
      previous &&
      ((previous.role === "headnote" && block.role === "headnote") ||
        previous.isLead)
    const sameSourceStyle =
      !previous?.typography ||
      !block.typography ||
      (previous.typography.dominantStyle === block.typography.dominantStyle &&
        previous.typography.stylePurity >= 0.8 &&
        block.typography.stylePurity >= 0.8)
    const proseContinues =
      previous &&
      (!endsSentence(previous.text) || startsAsContinuation(block.text))

    if (
      !crossesStructuredBoundary &&
      bothHeadnotes &&
      sameSourceStyle &&
      proseContinues &&
      !isHeadnoteBoundary(block.text)
    ) {
      previous.text = `${previous.text} ${block.text}`
        .replace(/\s+/g, " ")
        .trim()
      for (const page of block.sourcePages) {
        if (!previous.sourcePages.includes(page))
          previous.sourcePages.push(page)
      }
      previous.sourceChunkIds.push(...block.sourceChunkIds)
      previous.typography = mergeTypography(
        previous.typography,
        block.typography
      )
      continue
    }
    mergedBlocks.push(block)
  }

  return mergedBlocks
}

function buildHtml(source) {
  const { metadata } = source
  const blocks = source.blocks.filter(
    (block) => !isSourceFurniture(block, metadata)
  )
  // Must agree with the role classifier in poppler-layout.mjs; keeping a second
  // copy of the heuristic here is what let the two drift apart.
  const judgmentIndex = findJudgmentStart(blocks)
  const numberedParagraphs = logicalJudgmentParagraphs(
    judgmentIndex >= 0 ? blocks.slice(judgmentIndex) : blocks
  )
  // Judgments the OCR never numbered still have complete text; in calibration
  // 122 of 130 body-detection failures had no paragraph numbers anywhere. Fall
  // back to page-anchored prose instead of dropping the judgment.
  const unnumberedBody = numberedParagraphs.length === 0
  const preJudgmentBlocks = (
    unnumberedBody
      ? blocks.filter((block) => block.sourcePage < 2)
      : judgmentIndex >= 0
        ? blocks.slice(0, judgmentIndex)
        : []
  ).filter((block) => !isFrontMatterDuplicate(block, metadata))
  const deliveryBlock = preJudgmentBlocks.find((block) =>
    /^The (?:Judgment|Order) of the Court was (?:delivered|passed) by/i.test(
      block.text
    )
  )
  const digestBlocks = preJudgmentBlocks.filter(
    (block) => block !== deliveryBlock
  )
  const judges = Array.isArray(metadata.judges) ? metadata.judges : []
  const parties = splitCaseTitle(metadata.title)
  const logicalParagraphs = unnumberedBody
    ? unnumberedJudgmentParagraphs(blocks)
    : numberedParagraphs
  const orderedDigest = digestBlocks
  const logicalDigest = mergeHeadnoteContinuations(orderedDigest)
  const appearanceBlock = logicalDigest.find((block) =>
    /\b(?:Advs?\.? for the appearing parties|Applicant-in-person|for the petitioner|for the respondent)\b/i.test(
      block.text
    )
  )
  const relatedProceeding = source.blocks.find(
    (block) => block.sourcePage === 1 && /^\(Writ Petition/i.test(block.text)
  )?.text

  const caseLawReferenceTables = Array.isArray(source.caseLawReferenceTables)
    ? source.caseLawReferenceTables
    : []
  const tableByChunkId = new Map()
  for (const table of caseLawReferenceTables) {
    for (const chunkId of table.sourceChunkIds ?? [])
      tableByChunkId.set(chunkId, table)
  }
  const emittedTables = new Set()
  const digestParts = []
  for (const block of logicalDigest) {
    const table = block.sourceChunkIds
      .map((chunkId) => tableByChunkId.get(chunkId))
      .find(Boolean)
    if (table) {
      if (!emittedTables.has(table.id)) {
        digestParts.push(caseLawReferenceTableMarkup(table))
        emittedTables.add(table.id)
      }
      continue
    }
    if (block === appearanceBlock) {
      digestParts.push('<h3 class="minor-heading">Appearances</h3>')
    }
    digestParts.push(digestBlockMarkup(block))
  }
  if (emittedTables.size !== caseLawReferenceTables.length) {
    const missing = caseLawReferenceTables
      .filter((table) => !emittedTables.has(table.id))
      .map((table) => table.id)
    throw new Error(
      `Case-law reference table(s) could not be placed from source provenance: ${missing.join(", ")}`
    )
  }
  const digestHtml = digestParts.join("\n")
  const judgmentHtml = logicalParagraphs.map(judgmentParagraphMarkup).join("\n")

  const sourceUrl = metadata.source_pdf_url
    ? String(metadata.source_pdf_url)
    : ""
  const generatedOn = new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date())
  const runningCitation = String(
    metadata.neutral_citation ??
      metadata.reporter_citation ??
      metadata.judgment_id
  )
  const runningSource = `Vidhi Kosh Reading Copy · ${metadata.judgment_id}`
  const layout = source.layout
  const layoutProvenance = layout
    ? `Typography aligned ${Math.round((layout.alignment?.meanCoverage ?? 0) * 100)}% · Source PDF SHA-256 ${layout.sourcePdfSha256}`
    : null

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(metadata.title)} · Vidhi Kosh Reading Copy</title>
  <style>
    :root { --ink:#111; --muted:#606060; --line:#aaa; }
    * { box-sizing:border-box; }
    html, body { margin:0; padding:0; background:white; color:var(--ink); }
    body { font-family:"Noto Serif", "Liberation Serif", Georgia, "Times New Roman", serif; font-size:10.25pt; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    @page {
      size:A4;
      margin:21mm 18mm 18mm;
      @top-left { content:"VIDHI KOSH"; color:#222; font:700 6.5pt Arial,sans-serif; letter-spacing:.08em; }
      @top-right { content:${JSON.stringify(runningCitation)}; color:#555; font:6.5pt Arial,sans-serif; }
      @bottom-left { content:${JSON.stringify(runningSource)}; color:#777; font:5.5pt Arial,sans-serif; }
      @bottom-right { content:counter(page); color:#222; font:7pt Arial,sans-serif; }
    }
    @page:first {
      margin-top:14mm;
      @top-left { content:none; }
      @top-right { content:none; }
    }
    .masthead { display:flex; align-items:flex-end; justify-content:space-between; margin:0 0 5mm; padding:0 0 3mm; border-bottom:1px solid #555; font-family:Arial,sans-serif; }
    .brand { font-family:Georgia,"Times New Roman",serif; font-size:18pt; font-weight:700; letter-spacing:.04em; }
    .brand-note { margin-top:1mm; color:#555; font-size:6.5pt; letter-spacing:.04em; }
    .document-id { color:#555; font-size:6pt; line-height:1.4; text-align:right; }
    .citations { display:flex; justify-content:space-between; gap:6mm; margin-bottom:5mm; font-size:9pt; }
    .case-heading { text-align:center; break-inside:avoid; }
    .court { margin:0 0 3.5mm; font-size:10.5pt; font-weight:700; letter-spacing:.05em; text-transform:uppercase; }
    .coram { margin:0 auto 4mm; max-width:160mm; font-size:9.5pt; line-height:1.45; }
    .coram strong { font-weight:700; }
    .case-title { margin:5mm auto 3.5mm; font-size:13pt; font-weight:700; line-height:1.45; }
    .case-title .versus { display:block; margin:1.5mm 0; font-size:9.5pt; font-style:italic; font-weight:400; }
    .case-number, .decision-date, .related-case { margin:1.5mm 0; font-size:9.5pt; }
    .decision-date { font-weight:700; text-transform:uppercase; }
    .case-rule { width:36mm; margin:6mm auto; border:0; border-top:1px solid #555; }
    .section-heading { margin:7mm 0 4mm; font-size:10.5pt; text-align:center; text-transform:uppercase; break-after:avoid; }
    .digest-block { margin:0 0 3.3mm; line-height:1.48; text-align:justify; orphans:3; widows:3; }
    .digest-block.lead { font-weight:700; }
    .digest-block.source-italic { font-style:italic; font-weight:400; }
    .digest-block.source-bold { font-style:normal; font-weight:700; }
    .digest-block.source-bold-italic { font-style:italic; font-weight:700; }
    .digest-block.appearance { margin-bottom:2mm; font-size:9.5pt; }
    .minor-heading { margin:7mm 0 3mm; font-size:9.5pt; text-transform:uppercase; break-after:avoid; }
    .case-law-reference-section { margin:6mm 0; break-before:page; }
    .case-law-reference-table { width:130mm; max-width:100%; margin-inline:auto; border-collapse:collapse; table-layout:fixed; font-size:9.25pt; line-height:1.25; font-variant-numeric:tabular-nums; }
    .case-law-reference-table col.case-reference-citation-column { width:56%; }
    .case-law-reference-table col.case-reference-treatment-column { width:28%; }
    .case-law-reference-table col.case-reference-pinpoint-column { width:16%; }
    .case-law-reference-table thead { display:table-header-group; }
    .case-law-reference-table th { padding:0 0 2.5mm; font-weight:700; text-align:center; text-decoration:underline; }
    .case-law-reference-table tbody { break-inside:auto; }
    .case-law-reference-table tr { break-inside:avoid; page-break-inside:avoid; }
    .case-law-reference-table td { padding:.65mm 0; vertical-align:baseline; font-weight:700; text-align:left; }
    .case-law-reference-table td:nth-child(2), .case-law-reference-table td:nth-child(3) { padding-left:3mm; white-space:nowrap; }
    .judgment { margin-top:8mm; }
    .judgment-heading { margin:0 0 5mm; border-top:1px solid #555; padding-top:6mm; font-size:11pt; text-align:center; text-transform:uppercase; break-after:avoid; }
    .delivery-line { margin:0 0 4mm; font-weight:700; text-align:left; break-after:avoid; }
    .delivery-line + .judgment-paragraph { break-before:avoid; }
    .judgment-paragraph { margin:0 0 4mm; line-height:1.5; orphans:3; widows:3; }
    .judgment-paragraph > p { margin:0; text-align:justify; }
    .judgment-paragraph > p.continuation { margin-top:2.5mm; }
    .paragraph-number { margin-right:1.5mm; font-weight:700; }
    blockquote { margin:3mm 7mm; font-size:9.75pt; line-height:1.48; text-align:justify; }
    .footnotes { margin:2mm 0 4mm 8mm; border-top:1px solid #bbb; padding-top:2mm; font-size:8pt; line-height:1.35; }
    .footnotes p { margin:0 0 1mm; }
    .end-matter { margin-top:9mm; border-top:1px solid #555; padding-top:3mm; color:#666; font:6.5pt/1.45 Arial,sans-serif; break-inside:avoid; }
    .end-matter strong { color:#222; letter-spacing:.06em; text-transform:uppercase; }
    .source-url { word-break:break-all; }
    @media screen and (max-width:600px) {
      .case-law-reference-section { overflow-x:auto; }
      .case-law-reference-table { width:100%; min-width:30rem; }
    }
  </style>
</head>
<body data-reading-copy-source="${layout ? "poppler-enriched-layout" : "chunk-fallback"}">
  <header class="masthead">
    <div><div class="brand">VIDHI KOSH</div><div class="brand-note">Supreme Court of India · Reading Copy</div></div>
    <div class="document-id">${escapeHtml(metadata.judgment_id)}<br>Unofficial editorial reproduction</div>
  </header>
  <div class="citations"><span>${escapeHtml(metadata.reporter_citation ?? "")}</span><span>${escapeHtml(metadata.neutral_citation ?? "")}</span></div>
  <section class="case-heading">
    <div class="court">${escapeHtml(metadata.court ?? "Supreme Court of India")}</div>
    <p class="coram"><strong>Coram:</strong> ${judges.length ? judges.map(escapeHtml).join(", ") : "Not supplied"}</p>
    <div class="case-title">${parties ? `${escapeHtml(parties.petitioner)}<span class="versus">v.</span>${escapeHtml(parties.respondent)}` : escapeHtml(metadata.title)}</div>
    <p class="case-number">${escapeHtml(metadata.case_number ?? "Case number not supplied")}</p>
    ${relatedProceeding ? `<p class="related-case">In ${escapeHtml(relatedProceeding.replace(/^\(|\)$/g, ""))}</p>` : ""}
    <p class="decision-date">Decided on ${escapeHtml(dateLabel(metadata.decision_date))}</p>
    <hr class="case-rule">
  </section>

  ${
    digestBlocks.length
      ? `<section class="digest-section">
    <h2 class="section-heading">Headnote</h2>
    ${digestHtml}
  </section>`
      : ""
  }

  <section class="judgment">
    <h2 class="judgment-heading">Judgment</h2>
    ${deliveryBlock ? `<p class="delivery-line">${escapeHtml(deliveryBlock.text)}</p>` : ""}
    ${judgmentHtml}
    <div class="end-matter"><strong>End of judgment</strong><br>Vidhi Kosh Reading Copy · Generated ${escapeHtml(generatedOn)} · Source text SHA-256 ${escapeHtml(metadata.source_text_sha256 ?? "not supplied")}${layoutProvenance ? `<br>${escapeHtml(layoutProvenance)}` : ""}${sourceUrl ? `<br><span class="source-url">Preserved source: ${escapeHtml(sourceUrl)}</span>` : ""}</div>
  </section>
</body>
</html>`
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean)

  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // Try the next browser path.
    }
  }
  throw new Error("Google Chrome or Chromium was not found; set CHROME_PATH")
}

const input = await readFile(inputPath, "utf8")
const source = parseReadingCopyInput(input, extname(inputPath))
const html = buildHtml(source)
const chrome = await findChrome()
const temporaryDirectory = await mkdtemp(`${tmpdir()}/lex-reading-copy-`)
const temporaryHtmlPath = resolve(temporaryDirectory, `${defaultStem}.html`)

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(temporaryHtmlPath, html, "utf8")
if (explicitHtmlPath) {
  await mkdir(dirname(explicitHtmlPath), { recursive: true })
  await writeFile(explicitHtmlPath, html, "utf8")
}

try {
  execFileSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--allow-file-access-from-files",
      "--no-pdf-header-footer",
      `--print-to-pdf=${outputPath}`,
      pathToFileURL(temporaryHtmlPath).href,
    ],
    { stdio: "pipe", timeout: 180_000 }
  )
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}

console.log(
  JSON.stringify({
    input: inputPath,
    output: outputPath,
    html: explicitHtmlPath,
    judgment_id: source.metadata.judgment_id,
    source_pages: source.metadata.source_pdf_pages_represented,
    passages: source.blocks.length,
    case_law_reference_tables: source.caseLawReferenceTables?.length ?? 0,
    case_law_reference_rows: (source.caseLawReferenceTables ?? []).reduce(
      (sum, table) => sum + (table.rows?.length ?? 0),
      0
    ),
  })
)
