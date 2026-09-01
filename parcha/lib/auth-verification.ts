import "server-only"

import { cloudflareEnv } from "@/lib/server-env"

const EMAIL_TOKEN_PREFIX = "email-verification:"

async function tokenIdentifier(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${EMAIL_TOKEN_PREFIX}${hash}`
}

export async function registerEmailVerificationToken(token: string, email: string) {
  const now = new Date()
  const database = cloudflareEnv().AUTH_DB
  await database.batch([
    database
      .prepare("DELETE FROM verification WHERE identifier LIKE ?1 AND expiresAt <= ?2")
      .bind(`${EMAIL_TOKEN_PREFIX}%`, now.toISOString()),
    database
      .prepare(
        `INSERT INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
      )
      .bind(
        crypto.randomUUID(),
        await tokenIdentifier(token),
        email.toLowerCase(),
        new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
        now.toISOString(),
        now.toISOString()
      ),
  ])
}

export async function discardEmailVerificationToken(token: string) {
  await cloudflareEnv().AUTH_DB.prepare("DELETE FROM verification WHERE identifier = ?1")
    .bind(await tokenIdentifier(token))
    .run()
}

export async function consumeEmailVerificationToken(token: string): Promise<boolean> {
  const result = await cloudflareEnv().AUTH_DB.prepare(
    `DELETE FROM verification
      WHERE identifier = ?1 AND expiresAt > ?2
      RETURNING id`
  )
    .bind(await tokenIdentifier(token), new Date().toISOString())
    .all<{ id: string }>()
  return result.results.length > 0
}
