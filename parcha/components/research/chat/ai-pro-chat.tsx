"use client"

import {
  BookOpen,
  Bot,
  FileCheck2,
  Landmark,
  LoaderCircle,
  Scale,
} from "lucide-react"
import { useEffect, useRef } from "react"

import { AnswerText } from "../answer-text"
import { stageMetaFor } from "../lib/stage-meta"
import styles from "../ai-pro-chat.module.css"
import { useChatStore } from "../store/chat-store"
import { ChatComposer } from "./chat-composer"
import { ChatMessage } from "./chat-message"

const STARTERS = [
  {
    icon: Landmark,
    title: "Constitutional rights",
    query:
      "Explain Article 21 of the Constitution and the principles the Supreme Court applies.",
  },
  {
    icon: Scale,
    title: "Find the provision",
    query:
      "Which BNS provisions may apply when a person dishonestly takes movable property without consent?",
  },
  {
    icon: BookOpen,
    title: "Criminal procedure",
    query:
      "What does the BNSS provide about anticipatory bail, and what do the retrieved judgments add?",
  },
  {
    icon: FileCheck2,
    title: "Compare authorities",
    query:
      "Explain the constitutional protection against double jeopardy with supporting Supreme Court authorities.",
  },
]

export function AiProChat({ userName }: { userName: string }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const messages = useChatStore((state) => state.messages)
  const setQuery = useChatStore((state) => state.setQuery)
  const submit = useChatStore((state) => state.submit)
  const running = useChatStore((state) => state.running)
  const loadingThread = useChatStore((state) => state.loadingThread)
  const pendingQuery = useChatStore((state) => state.pendingQuery)
  const streamedAnswer = useChatStore((state) => state.streamedAnswer)
  const currentResult = useChatStore((state) => state.currentResult)
  const stages = useChatStore((state) => state.stages)
  const error = useChatStore((state) => state.error)
  const legalSources = useChatStore((state) => state.legalSources)
  const sources = useChatStore((state) => state.sources)

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    element.scrollTo({
      top: element.scrollHeight,
      behavior: running ? "smooth" : "auto",
    })
  }, [messages, pendingQuery, streamedAnswer, running])

  const startWith = (query: string) => {
    setQuery(query)
    window.requestAnimationFrame(() => void submit())
  }

  const hasConversation = messages.length > 0 || Boolean(pendingQuery)
  const activeStage = stageMetaFor("ai_pro")
    .map((meta) => ({ ...meta, state: stages[meta.id] }))
    .findLast((item) => item.state.status === "running")

  return (
    <main className={styles.chatMain}>
      <div className={styles.messageScroller} ref={scrollRef}>
        {loadingThread ? (
          <div className={styles.threadLoading}>
            <LoaderCircle size={22} /> Loading conversation…
          </div>
        ) : !hasConversation ? (
          <section className={styles.welcome}>
            <div className={styles.welcomeMark}>
              <Bot size={27} />
            </div>
            <span>LEX ARCHIVES / AI PRO</span>
            <h1>
              How can I help with your legal research
              {userName ? `, ${userName.split(" ")[0]}` : ""}?
            </h1>
            <p>
              Ask about the Constitution, BNS, BNSS, or a legal issue. Every
              substantive answer is rebuilt from retrieved primary law and
              Supreme Court passages.
            </p>
            <div className={styles.starterGrid}>
              {STARTERS.map((starter) => (
                <button
                  type="button"
                  key={starter.title}
                  onClick={() => startWith(starter.query)}
                >
                  <starter.icon size={17} />
                  <strong>{starter.title}</strong>
                  <span>{starter.query}</span>
                </button>
              ))}
            </div>
          </section>
        ) : (
          <div className={styles.messages}>
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
            {pendingQuery ? (
              <article className={styles.userMessage}>
                <div className={styles.userAvatar}>You</div>
                <p>{pendingQuery}</p>
              </article>
            ) : null}
            {running || error ? (
              <article className={styles.assistantMessage}>
                <div className={styles.assistantAvatar}>
                  <Bot size={17} />
                </div>
                <div className={styles.assistantBody}>
                  <div className={styles.messageMeta}>
                    <strong>AI Pro</strong>
                  </div>
                  {streamedAnswer && currentResult ? (
                    <AnswerText
                      answer={streamedAnswer}
                      citations={currentResult.citations}
                      streaming={running}
                      onCitation={() => undefined}
                      className={styles.chatAnswer}
                    />
                  ) : error ? (
                    <div className={styles.chatError}>
                      <strong>I couldn’t complete that answer.</strong>
                      <p>{error}</p>
                      <span>
                        Your message was not stored. You can edit it below and
                        retry.
                      </span>
                    </div>
                  ) : (
                    <div className={styles.thinking}>
                      <LoaderCircle size={17} />
                      <div>
                        <strong>
                          {activeStage?.state.message ??
                            "Preparing grounded research"}
                        </strong>
                        <span>
                          {legalSources.length || sources.length
                            ? `${legalSources.length} primary-law passages · ${sources.length} judgment passages`
                            : "Resolving the question and searching the legal indexes"}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            ) : null}
          </div>
        )}
      </div>
      <ChatComposer />
    </main>
  )
}
