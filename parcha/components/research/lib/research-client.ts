import type { ResearchMode, ResearchStreamEvent } from "@/lib/research/types"

/**
 * POSTs a research query and parses the NDJSON event stream, invoking `onEvent`
 * for every decoded line. Rejects with a descriptive Error on a non-OK
 * response; aborts surface as a DOMException with name "AbortError".
 */
export async function runResearchStream({
  query,
  mode,
  signal,
  onEvent,
}: {
  query: string
  mode: ResearchMode
  signal: AbortSignal
  onEvent: (event: ResearchStreamEvent) => void
}): Promise<void> {
  const response = await fetch("/api/research", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, mode }),
    signal,
  })

  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string
    }
    throw new Error(
      payload.error ?? `Research request failed (${response.status})`
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (line) onEvent(JSON.parse(line) as ResearchStreamEvent)
    }
    if (done) break
  }

  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as ResearchStreamEvent)
  }
}
