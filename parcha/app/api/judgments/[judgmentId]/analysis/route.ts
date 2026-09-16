import { getAuth } from "@/lib/auth"
import { getOrCreateJudgmentAnalysis } from "@/lib/judgment-analysis"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteParameters = {
  params: Promise<{ judgmentId: string }>
}

const JUDGMENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/

export async function POST(
  request: Request,
  { params }: RouteParameters
): Promise<Response> {
  const session = await getAuth().api.getSession({ headers: request.headers })
  if (!session) {
    return Response.json(
      { error: "Authentication required" },
      { status: 401, headers: { "cache-control": "no-store" } }
    )
  }

  const { judgmentId } = await params
  if (!JUDGMENT_ID.test(judgmentId)) {
    return Response.json(
      { error: "Judgment not found" },
      { status: 404, headers: { "cache-control": "no-store" } }
    )
  }

  try {
    const analysis = await getOrCreateJudgmentAnalysis(
      judgmentId,
      request.signal
    )
    if (!analysis) {
      return Response.json(
        { error: "Judgment not found" },
        { status: 404, headers: { "cache-control": "no-store" } }
      )
    }
    return Response.json(
      { analysis },
      { headers: { "cache-control": "private, no-store" } }
    )
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "judgment.analysis_failed",
        judgment_id: judgmentId,
        message: error instanceof Error ? error.message : "Unknown error",
      })
    )
    return Response.json(
      {
        error:
          "AI Pro could not prepare this judgment analysis right now. Please retry.",
      },
      { status: 502, headers: { "cache-control": "no-store" } }
    )
  }
}
