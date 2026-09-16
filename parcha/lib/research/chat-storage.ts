import "server-only"

import { cloudflareEnv } from "@/lib/server-env"

import type {
  ResearchChatMessage,
  ResearchConversationTurn,
  ResearchResult,
  ResearchThread,
  ResearchThreadSummary,
} from "./types"

const THREAD_LIST_LIMIT = 50
const CONTEXT_MESSAGE_LIMIT = 8
const CONTEXT_CHARACTER_LIMIT = 9_000

interface ThreadRow {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount?: number
}

interface MessageRow {
  id: string
  role: "user" | "assistant"
  content: string
  resultJson: string | null
  createdAt: string
}

function database(): CloudflareEnv["AUTH_DB"] {
  return cloudflareEnv().AUTH_DB
}

function summaryFrom(row: ThreadRow): ResearchThreadSummary {
  return {
    id: row.id,
    title: row.title,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    message_count: Number(row.messageCount ?? 0),
  }
}

function parsedResult(value: string | null): ResearchResult | undefined {
  if (!value) return undefined
  try {
    const result = JSON.parse(value) as ResearchResult
    return result && typeof result.answer === "string" ? result : undefined
  } catch {
    return undefined
  }
}

function messageFrom(row: MessageRow): ResearchChatMessage {
  const result = parsedResult(row.resultJson)
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    created_at: row.createdAt,
    ...(result ? { result } : {}),
  }
}

function titleFrom(query: string): string {
  const compact = query.replace(/\s+/g, " ").trim()
  return compact.length > 72 ? `${compact.slice(0, 69).trimEnd()}…` : compact
}

export async function listResearchThreads(
  userId: string
): Promise<ResearchThreadSummary[]> {
  const result = await database()
    .prepare(
      `SELECT t.id, t.title, t.createdAt, t.updatedAt,
        COUNT(m.id) AS messageCount
       FROM researchThread t
       LEFT JOIN researchMessage m ON m.threadId = t.id
       WHERE t.userId = ?1
       GROUP BY t.id
       ORDER BY t.updatedAt DESC
       LIMIT ?2`
    )
    .bind(userId, THREAD_LIST_LIMIT)
    .all<ThreadRow>()
  return result.results.map(summaryFrom)
}

export async function getResearchThread(
  userId: string,
  threadId: string
): Promise<ResearchThread | null> {
  const thread = await database()
    .prepare(
      `SELECT id, title, createdAt, updatedAt,
        (SELECT COUNT(*) FROM researchMessage WHERE threadId = researchThread.id) AS messageCount
       FROM researchThread
       WHERE id = ?1 AND userId = ?2
       LIMIT 1`
    )
    .bind(threadId, userId)
    .first<ThreadRow>()
  if (!thread) return null

  const messages = await database()
    .prepare(
      `SELECT id, role, content, resultJson, createdAt
       FROM researchMessage
       WHERE threadId = ?1
       ORDER BY createdAt ASC, rowid ASC`
    )
    .bind(threadId)
    .all<MessageRow>()

  return {
    ...summaryFrom(thread),
    messages: messages.results.map(messageFrom),
  }
}

export async function getConversationContext(
  userId: string,
  threadId: string
): Promise<ResearchConversationTurn[] | null> {
  const thread = await database()
    .prepare("SELECT id FROM researchThread WHERE id = ?1 AND userId = ?2")
    .bind(threadId, userId)
    .first<{ id: string }>()
  if (!thread) return null

  const result = await database()
    .prepare(
      `SELECT role, content
       FROM researchMessage
       WHERE threadId = ?1
       ORDER BY createdAt DESC, rowid DESC
       LIMIT ?2`
    )
    .bind(threadId, CONTEXT_MESSAGE_LIMIT)
    .all<{ role: "user" | "assistant"; content: string }>()

  let characters = 0
  const latestFirst: ResearchConversationTurn[] = []
  for (const message of result.results) {
    const content = message.content
      .replace(/\[\[[^\]]+\]\]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2_000)
    if (!content || characters + content.length > CONTEXT_CHARACTER_LIMIT)
      continue
    characters += content.length
    latestFirst.push({ role: message.role, content })
  }
  return latestFirst.reverse()
}

export async function persistResearchExchange({
  userId,
  threadId,
  query,
  result,
}: {
  userId: string
  threadId?: string
  query: string
  result: ResearchResult
}): Promise<ResearchThreadSummary> {
  const db = database()
  const now = new Date().toISOString()
  const id = threadId ?? crypto.randomUUID()
  const userMessageId = crypto.randomUUID()
  const assistantMessageId = crypto.randomUUID()

  if (threadId) {
    const owned = await db
      .prepare("SELECT id FROM researchThread WHERE id = ?1 AND userId = ?2")
      .bind(threadId, userId)
      .first<{ id: string }>()
    if (!owned) throw new Error("Research conversation was not found")
  }

  const statements: ReturnType<CloudflareEnv["AUTH_DB"]["prepare"]>[] = []
  if (!threadId) {
    statements.push(
      db
        .prepare(
          `INSERT INTO researchThread (id, userId, title, createdAt, updatedAt)
           VALUES (?1, ?2, ?3, ?4, ?4)`
        )
        .bind(id, userId, titleFrom(query), now)
    )
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO researchMessage (id, threadId, role, content, resultJson, createdAt)
         VALUES (?1, ?2, 'user', ?3, NULL, ?4)`
      )
      .bind(userMessageId, id, query, now),
    db
      .prepare(
        `INSERT INTO researchMessage (id, threadId, role, content, resultJson, createdAt)
         VALUES (?1, ?2, 'assistant', ?3, ?4, ?5)`
      )
      .bind(
        assistantMessageId,
        id,
        result.answer,
        JSON.stringify(result),
        new Date(Date.now() + 1).toISOString()
      ),
    db
      .prepare(
        "UPDATE researchThread SET updatedAt = ?1 WHERE id = ?2 AND userId = ?3"
      )
      .bind(now, id, userId)
  )
  await db.batch(statements)

  const stored = await db
    .prepare(
      `SELECT id, title, createdAt, updatedAt,
        (SELECT COUNT(*) FROM researchMessage WHERE threadId = researchThread.id) AS messageCount
       FROM researchThread WHERE id = ?1 AND userId = ?2`
    )
    .bind(id, userId)
    .first<ThreadRow>()
  if (!stored) throw new Error("Conversation could not be stored")
  return summaryFrom(stored)
}

export async function deleteResearchThread(
  userId: string,
  threadId: string
): Promise<boolean> {
  const db = database()
  const owned = await db
    .prepare("SELECT id FROM researchThread WHERE id = ?1 AND userId = ?2")
    .bind(threadId, userId)
    .first<{ id: string }>()
  if (!owned) return false
  await db.batch([
    db
      .prepare("DELETE FROM researchMessage WHERE threadId = ?1")
      .bind(threadId),
    db
      .prepare("DELETE FROM researchThread WHERE id = ?1 AND userId = ?2")
      .bind(threadId, userId),
  ])
  return true
}
