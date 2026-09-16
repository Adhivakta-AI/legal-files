"use client"

import { ArrowUp, Square } from "lucide-react"
import { useEffect, useRef, type FormEvent, type KeyboardEvent } from "react"

import styles from "../ai-pro-chat.module.css"
import { useChatStore } from "../store/chat-store"

export function ChatComposer() {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const query = useChatStore((state) => state.query)
  const running = useChatStore((state) => state.running)
  const setQuery = useChatStore((state) => state.setQuery)
  const submit = useChatStore((state) => state.submit)
  const abort = useChatStore((state) => state.abort)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = "0px"
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`
  }, [query])

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (running) abort()
    else void submit()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      if (!running) void submit()
    }
  }

  return (
    <div className={styles.composerDock}>
      <form className={styles.chatComposer} onSubmit={onSubmit}>
        <textarea
          ref={textareaRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask a follow-up or start a legal question…"
          aria-label="Message AI Pro"
          rows={1}
        />
        <button
          type="submit"
          disabled={!running && query.trim().length < 3}
          aria-label={running ? "Stop generating" : "Send message"}
        >
          {running ? (
            <Square size={14} fill="currentColor" />
          ) : (
            <ArrowUp size={18} />
          )}
        </button>
      </form>
      <p>
        AI Pro can make mistakes. Verify important propositions against the
        linked official sources.
      </p>
    </div>
  )
}
