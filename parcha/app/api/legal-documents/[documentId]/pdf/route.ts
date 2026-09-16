import { getAuth } from "@/lib/auth"
import { getLegalDocument } from "@/lib/legal-documents"
import { verifyPdfAccessToken } from "@/lib/pdf-access"
import { cloudflareEnv } from "@/lib/server-env"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteParameters = {
  params: Promise<{ documentId: string }>
}

type R2HeadObject = NonNullable<
  Awaited<ReturnType<CloudflareEnv["DOCUMENTS"]["head"]>>
>
type R2BodyObject = NonNullable<
  Awaited<ReturnType<CloudflareEnv["DOCUMENTS"]["get"]>>
>

function pdfHeaders(
  object: R2HeadObject,
  fileName: string,
  requestedRange: boolean
): Headers {
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set("accept-ranges", "bytes")
  headers.set("cache-control", "private, max-age=3600")
  headers.set("content-disposition", `inline; filename="${fileName}"`)
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

async function availableDocument(request: Request, documentId: string) {
  const token = new URL(request.url).searchParams.get("access")
  const signedAccess = await verifyPdfAccessToken(
    `legal-document:${documentId}`,
    token
  )
  let sessionAccess = false
  if (!signedAccess) {
    try {
      sessionAccess = Boolean(
        await getAuth().api.getSession({ headers: request.headers })
      )
    } catch {
      sessionAccess = false
    }
  }
  if (!signedAccess && !sessionAccess) {
    return { error: new Response("Authentication required", { status: 401 }) }
  }
  const document = await getLegalDocument(documentId)
  if (!document)
    return { error: new Response("Document not found", { status: 404 }) }
  return { document }
}

export async function GET(request: Request, { params }: RouteParameters) {
  const { documentId } = await params
  const result = await availableDocument(request, documentId)
  if ("error" in result) return result.error

  const rangeHeader = request.headers.get("range")
  let object: R2BodyObject | null
  try {
    object = await cloudflareEnv().DOCUMENTS.get(result.document.pdf_key, {
      ...(rangeHeader ? { range: request.headers } : {}),
    })
  } catch {
    return new Response("Requested PDF range is not satisfiable", {
      status: 416,
      headers: { "content-range": "bytes */*" },
    })
  }
  if (!object) return new Response("PDF not found", { status: 404 })

  const headers = pdfHeaders(
    object,
    `${result.document.id}.pdf`,
    Boolean(rangeHeader)
  )
  return new Response(object.body, {
    status: rangeHeader ? 206 : 200,
    headers,
  })
}

export async function HEAD(request: Request, { params }: RouteParameters) {
  const { documentId } = await params
  const result = await availableDocument(request, documentId)
  if ("error" in result) return result.error
  const object = await cloudflareEnv().DOCUMENTS.head(result.document.pdf_key)
  if (!object) return new Response(null, { status: 404 })
  return new Response(null, {
    headers: pdfHeaders(object, `${result.document.id}.pdf`, false),
  })
}
