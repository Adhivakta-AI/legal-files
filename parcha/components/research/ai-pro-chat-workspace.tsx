"use client"

import { useEffect, useRef } from "react"

import type { ResearchThreadSummary } from "@/lib/research/types"

import { AiProChat } from "./chat/ai-pro-chat"
import { ChatSidebar } from "./chat/chat-sidebar"
import { ResearchHeader } from "./research-header"
import type { ResearchUser } from "./research-account-menu"
import chatStyles from "./ai-pro-chat.module.css"
import researchStyles from "./research.module.css"
import { useChatStore } from "./store/chat-store"

export function AiProChatWorkspace({
  user,
  initialThreads,
}: {
  user: ResearchUser
  initialThreads: ResearchThreadSummary[]
}) {
  const initialized = useRef(false)
  const initialize = useChatStore((state) => state.initialize)
  const loadThread = useChatStore((state) => state.loadThread)
  const abort = useChatStore((state) => state.abort)
  const setSidebarOpen = useChatStore((state) => state.setSidebarOpen)

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      initialize(initialThreads)
      const threadId = new URLSearchParams(window.location.search).get("thread")
      if (threadId) void loadThread(threadId, false)
    }

    const onPopState = () => {
      const threadId = new URLSearchParams(window.location.search).get("thread")
      if (threadId) void loadThread(threadId, false)
      else useChatStore.getState().newChat(false)
    }
    window.addEventListener("popstate", onPopState)
    return () => {
      window.removeEventListener("popstate", onPopState)
      abort()
    }
  }, [abort, initialThreads, initialize, loadThread])

  return (
    <div className={`${researchStyles.root} ${chatStyles.chatRoot}`}>
      <ResearchHeader
        user={user}
        context="ai_pro"
        onOpenHistory={() => setSidebarOpen(true)}
      />
      <div className={chatStyles.chatShell}>
        <ChatSidebar />
        <AiProChat userName={user.name} />
      </div>
    </div>
  )
}
