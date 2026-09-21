export function collapseAdjacentChunkOverlap(text) {
  const words = text.split(/\s+/).filter(Boolean)
  const comparable = (word) =>
    word
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")

  let boundary = 1
  while (boundary < words.length) {
    const maximum = Math.min(80, boundary, words.length - boundary)
    let overlap = 0

    for (let size = maximum; size >= 8; size -= 1) {
      let matches = true
      for (let offset = 0; offset < size; offset += 1) {
        if (
          comparable(words[boundary - size + offset]) !==
          comparable(words[boundary + offset])
        ) {
          matches = false
          break
        }
      }
      if (matches) {
        overlap = size
        break
      }
    }

    if (overlap) {
      words.splice(boundary, overlap)
      boundary = Math.max(1, boundary - 4)
    } else {
      boundary += 1
    }
  }

  return words.join(" ")
}

function parseScalar(value) {
  const clean = value.trim()
  if (!clean || clean === "null") return null
  try {
    return JSON.parse(clean)
  } catch {
    return clean.replace(/^['"]|['"]$/g, "")
  }
}

export function parseReadingCopyMarkdown(markdown) {
  const normalized = markdown.replace(/\r\n?/g, "\n")
  const frontmatterMatch = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized)
  if (!frontmatterMatch)
    throw new Error("Reading-copy source has no frontmatter")

  const metadata = {}
  for (const line of frontmatterMatch[1].split("\n")) {
    const match = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line)
    if (match) metadata[match[1]] = parseScalar(match[2])
  }

  const judgmentStart = normalized.indexOf("## Judgment text")
  if (judgmentStart < 0)
    throw new Error("Reading-copy source has no judgment text")

  const lines = normalized
    .slice(judgmentStart + "## Judgment text".length)
    .split("\n")
  const blocks = []
  let sourcePage = null
  let index = 0

  while (index < lines.length) {
    const pageMatch = /^## Source PDF page (\d+)\s*$/.exec(lines[index])
    if (pageMatch) {
      sourcePage = Number.parseInt(pageMatch[1], 10)
      index += 1
      continue
    }

    const labelMatch = /^### (.+?)\s*$/.exec(lines[index])
    if (!labelMatch || sourcePage === null) {
      index += 1
      continue
    }

    const label = labelMatch[1]
    index += 1
    const sourceChunkIds = []
    const textLines = []

    while (
      index < lines.length &&
      !/^## Source PDF page \d+\s*$/.test(lines[index]) &&
      !/^### .+/.test(lines[index]) &&
      lines[index] !== "---"
    ) {
      const comment = /<!--\s*source_chunks:\s*(.*?);\s*text_source:/.exec(
        lines[index]
      )
      if (comment) {
        sourceChunkIds.push(...comment[1].split(",").map((id) => id.trim()))
      } else if (lines[index].trim()) {
        textLines.push(lines[index].trim())
      }
      index += 1
    }

    const joinedText = textLines.join(" ").replace(/\s+/g, " ").trim()
    const text =
      sourceChunkIds.length > 1
        ? collapseAdjacentChunkOverlap(joinedText)
        : joinedText
    if (text) {
      blocks.push({
        label,
        sourcePage,
        sourceChunkIds,
        text,
      })
    }
  }

  return { metadata, blocks }
}

export function parseReadingCopyInput(contents, extension = "") {
  if (extension.toLocaleLowerCase() !== ".json") {
    return parseReadingCopyMarkdown(contents)
  }

  const parsed = JSON.parse(contents)
  if (parsed.schema !== "lex-archives-reading-copy-layout/v1") {
    throw new Error(
      `Unsupported reading-copy JSON schema: ${parsed.schema ?? "missing"}`
    )
  }
  if (!parsed.metadata || !Array.isArray(parsed.blocks)) {
    throw new Error("Reading-copy layout JSON is missing metadata or blocks")
  }
  return {
    metadata: parsed.metadata,
    blocks: parsed.blocks,
    layout: parsed.layout,
    caseLawReferenceTables: parsed.caseLawReferenceTables ?? [],
    warnings: parsed.warnings ?? [],
  }
}
