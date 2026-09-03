import { getAuth } from "@/lib/auth"
import { consumeEmailVerificationToken } from "@/lib/auth-verification"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function handler(request: Request) {
  const url = new URL(request.url)
  const verifyingEmail =
    request.method === "GET" && url.pathname.endsWith("/api/auth/verify-email")
  const response = await getAuth().handler(request)
  if (verifyingEmail) {
    const token = url.searchParams.get("token")
    if (!token || !(await consumeEmailVerificationToken(token))) {
      return Response.redirect(
        new URL("/verify-email?error=INVALID_OR_EXPIRED_TOKEN", url),
        302
      )
    }
  }
  return response
}

export { handler as GET, handler as POST }
