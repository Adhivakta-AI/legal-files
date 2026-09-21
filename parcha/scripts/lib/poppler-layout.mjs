function decodeXml(value) {
  return value
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);/g, (_, decimal) =>
      String.fromCodePoint(Number.parseInt(decimal, 10))
    )
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&")
}

function parseAttributes(serialized) {
  const attributes = {}
  for (const match of serialized.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    attributes[match[1]] = match[2]
  }
  return attributes
}

export function normalizeToken(value) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, "")
}

export function tokensFromText(value) {
  return [...value.matchAll(/[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)*/gu)]
    .map((match) => ({
      raw: match[0],
      norm: normalizeToken(match[0]),
      start: match.index,
      end: match.index + match[0].length,
    }))
    .filter((token) => token.norm)
}

function normalizedFontFamily(value) {
  return String(value ?? "")
    .replace(/^[A-Z]{6}\+/i, "")
    .replace(/,(?:BoldItalic|Bold|Italic|Oblique)$/i, "")
}

export function parsePopplerXml(xml) {
  const fontMap = new Map()
  for (const match of xml.matchAll(/<fontspec\s+([^>]+?)\s*\/?\s*>/g)) {
    const attrs = parseAttributes(match[1])
    const rawFamily = attrs.family ?? ""
    fontMap.set(attrs.id, {
      family: normalizedFontFamily(rawFamily),
      rawFamily,
      size: Number(attrs.size),
      bold: /bold/i.test(rawFamily),
      italic: /italic|oblique/i.test(rawFamily),
    })
  }

  const pages = new Map()
  for (const pageMatch of xml.matchAll(/<page\s+([^>]+)>([\s\S]*?)<\/page>/g)) {
    const pageAttrs = parseAttributes(pageMatch[1])
    const pageNumber = Number(pageAttrs.number)
    const elements = []

    for (const textMatch of pageMatch[2].matchAll(/<text\s+([^>]+)>([\s\S]*?)<\/text>/g)) {
      const attrs = parseAttributes(textMatch[1])
      const text = decodeXml(textMatch[2]).replace(/\s+/g, " ").trim()
      if (!text) continue
      const inherited = fontMap.get(attrs.font) ?? {}
      const style = {
        family: inherited.family ?? "",
        size: inherited.size ?? null,
        bold: Boolean(inherited.bold || /<b(?:\s|>)/i.test(textMatch[2])),
        italic: Boolean(inherited.italic || /<i(?:\s|>)/i.test(textMatch[2])),
      }
      const element = {
        id: elements.length,
        page: pageNumber,
        text,
        top: Number(attrs.top),
        left: Number(attrs.left),
        width: Number(attrs.width),
        height: Number(attrs.height),
        style,
      }
      element.tokens = tokensFromText(text).map((token) => ({ ...token, element }))
      elements.push(element)
    }

    pages.set(pageNumber, {
      number: pageNumber,
      width: Number(pageAttrs.width),
      height: Number(pageAttrs.height),
      elements,
      tokens: elements.flatMap((element) => element.tokens),
    })
  }

  return { fontMap, pages }
}

// Local alignment tolerates overlapping search chunks and small OCR/text-layer
// differences while keeping matching constrained to the known source PDF page.
export function localTokenAlignment(queryTokens, pageTokens) {
  const rows = queryTokens.length + 1
  const columns = pageTokens.length + 1
  const scores = new Int16Array(rows * columns)
  const directions = new Uint8Array(rows * columns)
  let bestScore = 0
  let bestRow = 0
  let bestColumn = 0
  const at = (row, column) => row * columns + column

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const matches = queryTokens[row - 1].norm === pageTokens[column - 1].norm
      const diagonal = scores[at(row - 1, column - 1)] + (matches ? 3 : -3)
      const up = scores[at(row - 1, column)] - 1
      const left = scores[at(row, column - 1)] - 1
      const score = Math.max(0, diagonal, up, left)
      scores[at(row, column)] = score
      directions[at(row, column)] =
        score === 0 ? 0 : score === diagonal ? 1 : score === up ? 2 : 3
      if (score > bestScore) {
        bestScore = score
        bestRow = row
        bestColumn = column
      }
    }
  }

  const matches = []
  let row = bestRow
  let column = bestColumn
  while (row > 0 && column > 0 && scores[at(row, column)] > 0) {
    const direction = directions[at(row, column)]
    if (direction === 1) {
      if (queryTokens[row - 1].norm === pageTokens[column - 1].norm) {
        matches.push({ queryIndex: row - 1, pageIndex: column - 1 })
      }
      row -= 1
      column -= 1
    } else if (direction === 2) {
      row -= 1
    } else if (direction === 3) {
      column -= 1
    } else {
      break
    }
  }
  matches.reverse()
  return { score: bestScore, matches }
}

function styleKey(style) {
  if (style.bold && style.italic) return "bold-italic"
  if (style.bold) return "bold"
  if (style.italic) return "italic"
  return "regular"
}

function coalesceStyleRuns(tokenStyles, queryTokens) {
  const runs = []
  for (const tokenStyle of tokenStyles) {
    if (tokenStyle.style === "regular") continue
    const token = queryTokens[tokenStyle.queryIndex]
    const previous = runs.at(-1)
    if (
      previous &&
      previous.style === tokenStyle.style &&
      tokenStyle.queryIndex === previous.lastQueryIndex + 1
    ) {
      previous.end = token.end
      previous.lastQueryIndex = tokenStyle.queryIndex
      continue
    }
    runs.push({
      start: token.start,
      end: token.end,
      style: tokenStyle.style,
      lastQueryIndex: tokenStyle.queryIndex,
    })
  }
  return runs.map((run) => ({
    start: run.start,
    end: run.end,
    style: run.style,
  }))
}

function sourceProjection(elements) {
  const ordered = [...elements].sort((a, b) => a.id - b.id)
  let text = ""
  const styleRuns = []
  let previousElement = null

  for (const element of ordered) {
    let separator = ""
    if (text) {
      const joinsHyphenatedLine = /[-‐‑]\s*$/.test(text)
      const startsWithClosingPunctuation = /^[,.;:!?)}\]]/.test(element.text)
      const endsWithOpeningPunctuation = /[(\[{]\s*$/.test(text)
      separator =
        joinsHyphenatedLine || startsWithClosingPunctuation || endsWithOpeningPunctuation
          ? ""
          : " "
    }
    text += separator
    const start = text.length
    text += element.text
    const end = text.length
    const style = styleKey(element.style)
    if (style !== "regular") {
      const previousRun = styleRuns.at(-1)
      if (previousRun && previousRun.style === style && start <= previousRun.end + 1) {
        previousRun.end = end
      } else {
        styleRuns.push({ start, end, style })
      }
    }
    previousElement = element
  }

  return {
    text: text.replace(/\s+/g, " ").trim(),
    styleRuns,
    tokenCount: tokensFromText(text).length,
    elementCount: ordered.length,
    lastElement: previousElement?.id ?? null,
  }
}

export function alignBlockTypography(block, page) {
  if (!page) {
    return {
      queryTokenCount: tokensFromText(block.text).length,
      matchedTokenCount: 0,
      coverage: 0,
      dominantStyle: "unknown",
      stylePurity: 0,
      styleCounts: {},
      styleRuns: [],
      bounds: null,
      unmatchedQueryTokens: [],
    }
  }

  const queryTokens = tokensFromText(block.text)
  const result = localTokenAlignment(queryTokens, page.tokens)
  const matchedElements = new Map()
  const matchedQueryIndexes = new Set()
  const styleCounts = new Map()
  const tokenStyles = []

  for (const match of result.matches) {
    const pageToken = page.tokens[match.pageIndex]
    matchedElements.set(pageToken.element.id, pageToken.element)
    matchedQueryIndexes.add(match.queryIndex)
    const style = styleKey(pageToken.element.style)
    styleCounts.set(style, (styleCounts.get(style) ?? 0) + 1)
    tokenStyles.push({ queryIndex: match.queryIndex, style })
  }

  const orderedStyles = [...styleCounts.entries()].sort((a, b) => b[1] - a[1])
  const elements = [...matchedElements.values()]
  const normalizedQuery = queryTokens.map((token) => token.norm).join("")
  const normalizedPage = page.tokens.map((token) => token.norm).join("")
  const projected = sourceProjection(elements)
  const projectedTokenRatio = queryTokens.length
    ? projected.tokenCount / queryTokens.length
    : 0
  const useProjectedText =
    queryTokens.length > 0 &&
    result.matches.length / queryTokens.length >= 0.95 &&
    projectedTokenRatio >= 0.85 &&
    projectedTokenRatio <= 1.15

  return {
    queryTokenCount: queryTokens.length,
    matchedTokenCount: result.matches.length,
    exactNormalizedMatch: Boolean(normalizedQuery && normalizedPage.includes(normalizedQuery)),
    coverage: queryTokens.length ? result.matches.length / queryTokens.length : 0,
    dominantStyle: orderedStyles[0]?.[0] ?? "unknown",
    stylePurity: result.matches.length
      ? (orderedStyles[0]?.[1] ?? 0) / result.matches.length
      : 0,
    styleCounts: Object.fromEntries(orderedStyles),
    styleRuns: useProjectedText
      ? projected.styleRuns
      : coalesceStyleRuns(tokenStyles, queryTokens),
    projectedText: useProjectedText ? projected.text : null,
    projectedTextTokenRatio: projectedTokenRatio,
    projectedElementCount: projected.elementCount,
    bounds: elements.length
      ? {
          top: Math.min(...elements.map((element) => element.top)),
          bottom: Math.max(...elements.map((element) => element.top + element.height)),
          left: Math.min(...elements.map((element) => element.left)),
          right: Math.max(...elements.map((element) => element.left + element.width)),
        }
      : null,
    unmatchedQueryTokens: queryTokens
      .filter((_, index) => !matchedQueryIndexes.has(index))
      .slice(0, 40)
      .map((token) => token.raw),
  }
}

function paragraphNumber(block) {
  return /^Paragraph\s+(.+)$/i.exec(block.label)?.[1]?.trim() ?? null
}

function looksLikeFurniture(block, metadata) {
  // The length guard has to come first, exactly as isSourceFurniture does it in
  // generate-reading-copy-pdf.mjs. Testing for the reporter header ahead of it
  // classified any block merely *containing* a running header as furniture, so
  // short orders whose every body block carries one ended up with no body at
  // all: 585 judgments failed that way in the first full run.
  if (block.text.length > 190) return false
  if (/\bSUPREME\s+COURT(?:\s*\[\d{4}\])?\s*REPORTS?/i.test(block.text)) return true
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

function inferRole(block, index, judgmentIndex, metadata) {
  if (looksLikeFurniture(block, metadata)) return "front_matter"
  if (index >= judgmentIndex && judgmentIndex >= 0) {
    if (paragraphNumber(block)) return "judgment_paragraph"
    if (/^\d{1,3}\s+(?:\(\d{4}\)|AIR\s+\d{4})/.test(block.text)) return "footnote"
    if (/^[“"‘']|^\(?[ivxlcdm]+[.)]\s+/i.test(block.text)) return "quote"
    return "judgment_continuation"
  }
  if (/^The (?:Judgment|Order) of the Court was (?:delivered|passed) by/i.test(block.text)) {
    return "judgment_heading"
  }
  if (/\b(?:Advs?\.? for the appearing parties|Applicant-in-person|for the petitioner|for the respondent)\b/i.test(block.text)) {
    return "appearance"
  }
  if (
    /\b(?:SCC|S\.C\.C\.|SCR|S\.C\.R\.|AIR)\b/.test(block.text) &&
    /\b(?:relied on|referred to|followed|distinguished|overruled)\b/i.test(block.text)
  ) {
    return "authority_list"
  }
  if (block.typography.dominantStyle === "italic" && block.typography.stylePurity >= 0.8) {
    return "headnote"
  }
  return "front_matter"
}

/**
 * Locates the first block of the judgment body.
 *
 * Requiring a paragraph literally numbered "1" loses most of the corpus: in
 * batch-02, 77.5% of judgments have no such paragraph (OCR drops it, or the
 * reporter's numbering simply starts at 2), and every one of them previously
 * collapsed to `judgmentIndex === -1`, which marked the entire document as
 * front matter and rendered an empty judgment. These fallbacks recover ~79% of
 * those; whatever is left is rejected by validateReadingCopyLayout.
 */
export function findJudgmentStart(blocks) {
  const onBody = (block) => block.sourcePage >= 2

  const exact = blocks.findIndex(
    (block) => paragraphNumber(block) === "1" && onBody(block)
  )
  if (exact >= 0) return exact

  // The lowest plausible paragraph number on a body page. Bounded because OCR
  // parses years ("1950", "1913") into the paragraph-number field.
  let lowest = null
  let lowestIndex = -1
  blocks.forEach((block, index) => {
    if (!onBody(block)) return
    const parsed = Number.parseInt(paragraphNumber(block) ?? "", 10)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 300) return
    if (lowest === null || parsed < lowest) {
      lowest = parsed
      lowestIndex = index
    }
  })
  if (lowestIndex >= 0) return lowestIndex

  const delivered = blocks.findIndex((block) =>
    /^The (?:Judgment|Order) of the Court was (?:delivered|passed) by/i.test(
      block.text ?? ""
    )
  )
  if (delivered >= 0) return delivered

  const leading = blocks.findIndex(
    (block) => onBody(block) && /^\s*\d{1,3}[.)]\s/.test(block.text ?? "")
  )
  if (leading >= 0) return leading

  // Judgments the OCR never numbered at all. The reporter convention puts front
  // matter and the headnote on page 1, so the body starts at the first block on
  // a later page. The renderer emits these as unnumbered prose, and the
  // post-render gate in build-reading-copy.mjs still rejects an empty body.
  return blocks.findIndex(onBody)
}

export function enrichBlocksWithTypography(source, pdf) {
  const judgmentIndex = findJudgmentStart(source.blocks)
  return source.blocks.map((block, index) => {
    const typography = alignBlockTypography(block, pdf.pages.get(block.sourcePage))
    const projectedText = typography.projectedText
    const enriched = {
      ...block,
      ...(projectedText && projectedText !== block.text
        ? {
            indexedText: block.text,
            text: projectedText,
            displayTextSource: "source-pdf-aligned",
          }
        : { displayTextSource: "indexed-chunks" }),
      typography,
    }
    return { ...enriched, role: inferRole(enriched, index, judgmentIndex, source.metadata) }
  })
}

export function summarizeAlignment(blocks) {
  const aligned = blocks.filter((block) => block.typography.queryTokenCount > 0)
  const meanCoverage = aligned.length
    ? aligned.reduce((sum, block) => sum + block.typography.coverage, 0) / aligned.length
    : 0
  return {
    blockCount: blocks.length,
    meanCoverage,
    exactBlockCount: aligned.filter((block) => block.typography.exactNormalizedMatch).length,
    atLeast98Percent: aligned.filter((block) => block.typography.coverage >= 0.98).length,
    atLeast90Percent: aligned.filter((block) => block.typography.coverage >= 0.9).length,
    atLeast80Percent: aligned.filter((block) => block.typography.coverage >= 0.8).length,
    below80Percent: aligned.filter((block) => block.typography.coverage < 0.8).length,
    sourceTextProjectionCount: blocks.filter(
      (block) => block.displayTextSource === "source-pdf-aligned"
    ).length,
  }
}
