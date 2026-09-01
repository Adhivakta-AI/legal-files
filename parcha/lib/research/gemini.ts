import "server-only"

import { requiredServerSetting, serverSetting } from "@/lib/server-env"

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"

export class GeminiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = "GeminiRequestError"
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
}

function apiKey(): string {
  return requiredServerSetting("GEMINI_API_KEY")
}

function model(): string {
  const value = serverSetting("GEMINI_MODEL") ?? "gemini-2.5-flash"
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error("GEMINI_MODEL contains unsupported characters")
  }
  return value
}

function boundedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

async function geminiFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const body = init.body
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const startedAt = performance.now()
    const operation = new URL(url).pathname.split("/").at(-1) ?? "generateContent"
    console.info(JSON.stringify({
      event: "gemini.request",
      operation,
      attempt: attempt + 1,
    }))
    let response: Response
    try {
      response = await fetch(url, {
        ...init,
        body,
        signal: boundedSignal(init.signal ?? undefined, timeoutMs),
      })
    } catch (error) {
      console.error(JSON.stringify({
        event: "gemini.network_error",
        operation,
        attempt: attempt + 1,
        duration_ms: Math.round(performance.now() - startedAt),
      }))
      if (init.signal?.aborted) throw error
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 700 + Math.random() * 300))
        continue
      }
      throw new GeminiRequestError("Gemini timed out before returning a response", 504)
    }

    console.info(JSON.stringify({
      event: "gemini.response",
      operation,
      attempt: attempt + 1,
      status: response.status,
      duration_ms: Math.round(performance.now() - startedAt),
    }))

    if (response.ok) return response
    const responseBody = await response.text()
    const transient = response.status === 408 || response.status === 429 || response.status >= 500
    if (transient && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 700 + Math.random() * 300))
      continue
    }
    throw new GeminiRequestError(
      `Gemini request failed (${response.status}): ${responseBody.slice(0, 240)}`,
      response.status
    )
  }
  throw new GeminiRequestError("Gemini request failed", 500)
}

function candidateText(payload: GeminiResponse): string {
  const text =
    payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("") ?? ""
  if (!text && payload.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the request: ${payload.promptFeedback.blockReason}`)
  }
  return text
}

export async function generateJson<T>({
  systemInstruction,
  prompt,
  schema,
  signal,
}: {
  systemInstruction: string
  prompt: string
  schema: Record<string, unknown>
  signal?: AbortSignal
}): Promise<T> {
  const response = await geminiFetch(
    `${GEMINI_BASE_URL}/models/${model()}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey(),
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
          responseJsonSchema: schema,
        },
      }),
      cache: "no-store",
      signal,
    },
    10_000
  )

  const payload = (await response.json()) as GeminiResponse
  const text = candidateText(payload)
  if (!text) throw new Error("Gemini returned an empty structured response")
  return JSON.parse(text) as T
}

export async function* streamJson({
  systemInstruction,
  prompt,
  schema,
  signal,
}: {
  systemInstruction: string
  prompt: string
  schema: Record<string, unknown>
  signal?: AbortSignal
}): AsyncGenerator<string> {
  const response = await geminiFetch(
    `${GEMINI_BASE_URL}/models/${model()}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey(),
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.15,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          responseJsonSchema: schema,
        },
      }),
      cache: "no-store",
      signal,
    },
    45_000
  )

  if (!response.body) throw new GeminiRequestError("Gemini returned an empty stream", 502)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      if (!line.startsWith("data:")) continue
      const data = line.slice(5).trim()
      if (!data || data === "[DONE]") continue
      const payload = JSON.parse(data) as GeminiResponse
      const text = candidateText(payload)
      if (text) yield text
    }

    if (done) break
  }

  const finalLine = buffer.trim()
  if (finalLine.startsWith("data:")) {
    const data = finalLine.slice(5).trim()
    if (data && data !== "[DONE]") {
      const text = candidateText(JSON.parse(data) as GeminiResponse)
      if (text) yield text
    }
  }
}
