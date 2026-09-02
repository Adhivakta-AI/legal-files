"use client"

import { History, Plus, Search, X } from "lucide-react"

import type { HistoryItem } from "./lib/history-storage"
import styles from "./research.module.css"
import { useHistoryStore } from "./store/history-store"
import { useResearchStore } from "./store/research-store"

export function HistorySidebar() {
  const items = useHistoryStore((state) => state.items)
  const open = useHistoryStore((state) => state.open)
  const setOpen = useHistoryStore((state) => state.setOpen)
  const restore = useResearchStore((state) => state.restore)
  const reset = useResearchStore((state) => state.reset)

  const startNew = () => {
    reset()
    setOpen(false)
  }

  const pick = (item: HistoryItem) => {
    restore(item)
    setOpen(false)
  }

  return (
    <>
      <aside className={styles.historySidebar} data-open={open}>
        <div className={styles.mobileSidebarHeader}>
          <span>RESEARCH HISTORY</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close history"
          >
            <X size={17} />
          </button>
        </div>
        <button
          type="button"
          className={styles.newResearchButton}
          onClick={startNew}
        >
          <Plus size={15} /> New research
        </button>
        <div className={styles.sidebarLabel}>
          <History size={12} /> RECENT QUERIES
        </div>
        <div className={styles.historyList}>
          {items.length ? (
            items.map((item) => (
              <button type="button" key={item.id} onClick={() => pick(item)}>
                <Search size={13} />
                <span>{item.query}</span>
                <time>
                  {new Date(item.created_at).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                  })}
                </time>
              </button>
            ))
          ) : (
            <div className={styles.historyEmpty}>
              Your completed research sessions will remain on this device.
            </div>
          )}
        </div>
        <div className={styles.sidebarFooter}>
          <div>
            <span className={styles.statusDot} /> SEARCH API ONLINE
          </div>
          <span>384D BGE · HYBRID RRF</span>
        </div>
      </aside>
      {open ? (
        <button
          type="button"
          className={styles.sidebarScrim}
          onClick={() => setOpen(false)}
          aria-label="Close history"
        />
      ) : null}
    </>
  )
}
