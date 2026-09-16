import "server-only"

import { requiredServerSetting } from "@/lib/server-env"

const encoder = new TextEncoder()
const MAX_TOKEN_LIFETIME_SECONDS = 24 * 60 * 60

function encoded(value: string): ArrayBuffer {
  const bytes = encoder.encode(value)
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
}

async function hmacKey(usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoded(requiredServerSetting("BETTER_AUTH_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage]
  )
}

function tokenPayload(resource: string, expiresAt: number): ArrayBuffer {
  return encoded(`lex-pdf:${resource}:${expiresAt}`)
}

export async function createPdfAccessToken(
  resource: string,
  lifetimeSeconds = 6 * 60 * 60
): Promise<string> {
  const lifetime = Math.min(
    Math.max(Math.round(lifetimeSeconds), 60),
    MAX_TOKEN_LIFETIME_SECONDS
  )
  const expiresAt = Math.floor(Date.now() / 1000) + lifetime
  const signature = await crypto.subtle.sign(
    "HMAC",
    await hmacKey("sign"),
    tokenPayload(resource, expiresAt)
  )
  return `${expiresAt}.${Buffer.from(signature).toString("base64url")}`
}

export async function verifyPdfAccessToken(
  resource: string,
  token: string | null
): Promise<boolean> {
  if (!token || token.length > 160) return false
  const separator = token.indexOf(".")
  if (separator <= 0 || separator === token.length - 1) return false
  const expiryText = token.slice(0, separator)
  if (!/^\d{10}$/.test(expiryText)) return false
  const expiresAt = Number.parseInt(expiryText, 10)
  const now = Math.floor(Date.now() / 1000)
  if (expiresAt <= now || expiresAt > now + MAX_TOKEN_LIFETIME_SECONDS) {
    return false
  }
  let signature: Buffer
  try {
    signature = Buffer.from(token.slice(separator + 1), "base64url")
  } catch {
    return false
  }
  if (signature.byteLength !== 32) return false
  return crypto.subtle.verify(
    "HMAC",
    await hmacKey("verify"),
    Uint8Array.from(signature).buffer as ArrayBuffer,
    tokenPayload(resource, expiresAt)
  )
}
