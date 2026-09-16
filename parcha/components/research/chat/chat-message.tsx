"use client"

import { Bot, ChevronDown, FileText, ShieldCheck, User } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import type { Citation, ResearchChatMessage } from "@/lib/research/types"

import { AnswerText } from "../answer-text"
import { CitationCard } from "../citation-card"
import { citationSourceId, citationSourceType } from "../lib/format"
import { useChatStore } from "../store/chat-store"
import styles from "../ai-pro-chat.module.css"

export function ChatMessage({ message }: { message: ResearchChatMessage }) {
  const router = useRouter()
  const activeThreadId = useChatStore((state) => state.activeThreadId)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null)
  const citations = message.result?.citations ?? []

  const focusCitation = (citation: Citation) => {
    const sourceId = citationSourceId(citation)
    setSourcesOpen(true)
    setExpandedSourceId(sourceId)
    window.requestAnimationFrame(() => {
      document
        .getElementById(`chat-citation-${message.id}-${sourceId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" })
    })
  }

  const openSource = (citation: Citation) => {
    if (citationSourceType(citation) === "legislation") {
      const documentId = citation.document_id
      if (!documentId) return
      const params = new URLSearchParams({
        page: String(Math.max(1, citation.pdf_page)),
        from: "ai-pro",
      })
      if (activeThreadId) params.set("thread", activeThreadId)
      if (citation.chunk_id) params.set("chunk", citation.chunk_id)
      if (citation.unit_kind && citation.unit_number) {
        params.set("unit", `${citation.unit_kind} ${citation.unit_number}`)
      }
      router.push(
        `/legal/${encodeURIComponent(documentId)}?${params.toString()}`
      )
      return
    }
    const params = new URLSearchParams({
      page: String(Math.max(1, citation.pdf_page)),
      from: "ai-pro",
    })
    if (activeThreadId) params.set("thread", activeThreadId)
    if (citation.chunk_id) params.set("chunk", citation.chunk_id)
    router.push(
      `/browse/${encodeURIComponent(citation.judgment_id ?? citation.source_id)}?${params.toString()}`
    )
  }

  if (message.role === "user") {
    return (
      <article className={styles.userMessage}>
        <div className={styles.userAvatar}>
          <User size={14} />
        </div>
        <p>{message.content}</p>
      </article>
    )
  }

  return (
    <article className={styles.assistantMessage}>
      <div className={styles.assistantAvatar}>
        <Bot size={17} />
      </div>
      <div className={styles.assistantBody}>
        <div className={styles.messageMeta}>
          <strong>AI Pro</strong>
          {message.result ? (
            <span data-confidence={message.result.confidence}>
              <ShieldCheck size={12} /> {message.result.confidence} confidence
            </span>
          ) : null}
        </div>
        {message.result ? (
          <AnswerText
            answer={message.content}
            citations={citations}
            streaming={false}
            onCitation={focusCitation}
            className={styles.chatAnswer}
          />
        ) : (
          <p>{message.content}</p>
        )}

        {citations.length ? (
          <div className={styles.messageSources} data-open={sourcesOpen}>
            <button
              type="button"
              onClick={() => setSourcesOpen((open) => !open)}
            >
              <FileText size={14} />
              {citations.length} verified source
              {citations.length === 1 ? "" : "s"}
              <ChevronDown size={14} />
            </button>
            {sourcesOpen ? (
              <div className={styles.messageSourceList}>
                {citations.map((citation, index) => {
                  const sourceId = citationSourceId(citation)
                  return (
                    <CitationCard
                      key={sourceId}
                      citation={citation}
                      index={index}
                      mode="ai_pro"
                      showRelevance
                      expanded={expandedSourceId === sourceId}
                      onToggle={() =>
                        setExpandedSourceId((current) =>
                          current === sourceId ? null : sourceId
                        )
                      }
                      onOpen={() => openSource(citation)}
                      domId={`chat-citation-${message.id}-${sourceId}`}
                    />
                  )
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  )
}
