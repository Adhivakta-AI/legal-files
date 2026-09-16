"use client"

import { MessageSquareText, Plus, Scale, Trash2, X } from "lucide-react"
import styles from "../ai-pro-chat.module.css"
import { useChatStore } from "../store/chat-store"

function relativeDate(value: string): string {
  const date = new Date(value)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return "Today"
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday"
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
}

export function ChatSidebar() {
  const threads = useChatStore((state) => state.threads)
  const activeThreadId = useChatStore((state) => state.activeThreadId)
  const open = useChatStore((state) => state.sidebarOpen)
  const running = useChatStore((state) => state.running)
  const newChat = useChatStore((state) => state.newChat)
  const loadThread = useChatStore((state) => state.loadThread)
  const deleteThread = useChatStore((state) => state.deleteThread)
  const setOpen = useChatStore((state) => state.setSidebarOpen)

  const confirmDelete = (threadId: string) => {
    if (!window.confirm("Delete this conversation? This cannot be undone.")) return
    void deleteThread(threadId)
  }

  return (
    <>
      <aside className={styles.sidebar} data-open={open}>
        <div className={styles.mobileSidebarHeader}>
          <span>CONVERSATIONS</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close conversations"
          >
            <X size={17} />
          </button>
        </div>

        <button
          type="button"
          className={styles.newChatButton}
          onClick={() => newChat()}
          disabled={running}
        >
          <Plus size={17} />
          <span>New chat</span>
        </button>

        <div className={styles.sidebarLabel}>
          <MessageSquareText size={13} /> Recent conversations
        </div>

        <div className={styles.threadList}>
          {threads.length ? (
            threads.map((thread) => (
              <div
                key={thread.id}
                className={styles.threadRow}
                data-active={thread.id === activeThreadId}
              >
                <button
                  type="button"
                  className={styles.threadButton}
                  onClick={() => void loadThread(thread.id)}
                  disabled={running}
                >
                  <MessageSquareText size={14} />
                  <span>
                    <strong>{thread.title}</strong>
                    <small>{relativeDate(thread.updated_at)}</small>
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.deleteThreadButton}
                  aria-label={`Delete ${thread.title}`}
                  onClick={() => confirmDelete(thread.id)}
                  disabled={running}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          ) : (
            <div className={styles.emptyThreads}>
              Your legal conversations will appear here and sync across devices.
            </div>
          )}
        </div>

        <div className={styles.sidebarStatus}>
          <Scale size={14} />
          <div>
            <strong>Grounded legal chat</strong>
            <span>Primary law + Supreme Court authorities</span>
          </div>
        </div>
      </aside>
      {open ? (
        <button
          type="button"
          className={styles.sidebarScrim}
          onClick={() => setOpen(false)}
          aria-label="Close conversations"
        />
      ) : null}
    </>
  )
}
