import { getAuth } from "@/lib/auth"
import { verifyPdfAccessToken } from "@/lib/pdf-access"
import { cloudflareEnv } from "@/lib/server-env"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteParameters = {
  params: Promise<{ judgmentId: string }>
}

interface JudgmentPdfRecord {
  id: string
  pdf_url: string
  pdf_key: string | null
}

type R2HeadObject = NonNullable<
  Awaited<ReturnType<CloudflareEnv["DOCUMENTS"]["head"]>>
>
type R2BodyObject = NonNullable<
  Awaited<ReturnType<CloudflareEnv["DOCUMENTS"]["get"]>>
>

const JUDGMENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/

function responseHeaders(source: Headers, fileName: string): Headers {
  const headers = new Headers()
  for (const name of [
    "accept-ranges",
    "content-length",
    "content-range",
    "etag",
    "last-modified",
  ]) {
    const value = source.get(name)
    if (value) headers.set(name, value)
  }
  headers.set("cache-control", "private, max-age=3600")
  headers.set("content-disposition", `inline; filename="${fileName}.pdf"`)
  headers.set("content-type", "application/pdf")
  headers.set("x-content-type-options", "nosniff")
  return headers
}

function r2Headers(
  object: R2HeadObject | R2BodyObject,
  fileName: string,
  requestedRange: boolean
): Headers {
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set("accept-ranges", "bytes")
  headers.set("cache-control", "private, max-age=3600")
  headers.set("content-disposition", `inline; filename="${fileName}.pdf"`)
  headers.set("content-type", "application/pdf")
  headers.set("etag", object.httpEtag)
  headers.set("x-content-type-options", "nosniff")
  const range = object.range
  if (requestedRange && range) {
    const isSuffix = "suffix" in range && range.suffix !== undefined
    const offset =
      "offset" in range && range.offset !== undefined ? range.offset : 0
    const length = isSuffix
      ? Math.min(range.suffix, object.size)
      : "length" in range && range.length !== undefined
        ? range.length
        : object.size - offset
    const start = isSuffix ? object.size - length : offset
    headers.set("content-length", String(length))
    headers.set(
      "content-range",
      `bytes ${start}-${start + length - 1}/${object.size}`
    )
  } else {
    headers.set("content-length", String(object.size))
  }
  return headers
}

async function mayReadPdf(
  request: Request,
  resource: string
): Promise<boolean> {
  const token = new URL(request.url).searchParams.get("access")
  if (await verifyPdfAccessToken(resource, token)) return true
  try {
    return Boolean(await getAuth().api.getSession({ headers: request.headers }))
  } catch {
    return false
  }
}

async function judgmentPdf(request: Request, judgmentId: string) {
  if (!(await mayReadPdf(request, `judgment:${judgmentId}`))) {
    return { error: new Response("Authentication required", { status: 401 }) }
  }
  if (!JUDGMENT_ID.test(judgmentId))
    return { error: new Response("Judgment not found", { status: 404 }) }
  const judgment = await cloudflareEnv()
    .LEGAL_DB.prepare(
      "SELECT id, pdf_url, pdf_key FROM judgments WHERE id = ?1"
    )
    .bind(judgmentId)
    .first<JudgmentPdfRecord>()
  if (!judgment)
    return { error: new Response("Judgment not found", { status: 404 }) }
  return { judgment }
}

async function fromArchive(
  request: Request,
  judgmentId: string,
  includeBody: boolean
): Promise<Response | null> {
  const key = `judgments/${judgmentId}/source.pdf`
  const range = request.headers.get("range")
  const bucket = cloudflareEnv().DOCUMENTS
  const archived = await bucket.head(key)
  if (!archived) return null
  if (!includeBody) {
    return new Response(null, {
      headers: r2Headers(archived, judgmentId, false),
    })
  }
  let object: R2BodyObject | null
  try {
    object = await bucket.get(key, {
      ...(range ? { range: request.headers } : {}),
    })
  } catch {
    return new Response("Requested PDF range is not satisfiable", {
      status: 416,
      headers: { "content-range": "bytes */*" },
    })
  }
  return object
    ? new Response(object.body, {
        status: range ? 206 : 200,
        headers: r2Headers(object, judgmentId, Boolean(range)),
      })
    : null
}

async function fromOriginal(
  request: Request,
  judgment: JudgmentPdfRecord,
  method: "GET" | "HEAD"
): Promise<Response> {
  let url: URL
  try {
    url = new URL(judgment.pdf_url)
  } catch {
    return new Response("PDF source is invalid", { status: 502 })
  }
  if (url.protocol !== "https:")
    return new Response("PDF source is invalid", { status: 502 })

  const range = request.headers.get("range")
  const upstream = await fetch(url, {
    method,
    headers: range ? { range } : undefined,
    redirect: "follow",
  })
  if (!upstream.ok) {
    return new Response("PDF source is temporarily unavailable", {
      status: upstream.status === 404 ? 404 : 502,
    })
  }
  return new Response(method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers: responseHeaders(upstream.headers, judgment.id),
  })
}

export async function GET(request: Request, { params }: RouteParameters) {
  const { judgmentId } = await params
  const result = await judgmentPdf(request, judgmentId)
  if ("error" in result) return result.error
  const archived = await fromArchive(request, judgmentId, true)
  return archived ?? fromOriginal(request, result.judgment, "GET")
}

export async function HEAD(request: Request, { params }: RouteParameters) {
  const { judgmentId } = await params
  const result = await judgmentPdf(request, judgmentId)
  if ("error" in result) return result.error
  const archived = await fromArchive(request, judgmentId, false)
  return archived ?? fromOriginal(request, result.judgment, "HEAD")
}
