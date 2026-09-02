"use client"

import { Select } from "@base-ui/react/select"
import { Check, ChevronDown, Search, Sparkles } from "lucide-react"

import type { ResearchMode } from "@/lib/research/types"

import { RESEARCH_MODES } from "./lib/research-modes"
import styles from "./research.module.css"
import { useResearchStore } from "./store/research-store"

export function ResearchModeIcon({
  mode,
  size = 15,
}: {
  mode: ResearchMode
  size?: number
}) {
  return mode === "search" ? <Search size={size} /> : <Sparkles size={size} />
}

export function ModeSelect() {
  const mode = useResearchStore((state) => state.mode)
  const setMode = useResearchStore((state) => state.setMode)
  const running = useResearchStore((state) => state.running)

  return (
    <Select.Root<ResearchMode>
      value={mode}
      onValueChange={(value) => value && setMode(value)}
      disabled={running}
    >
      <Select.Trigger
        className={styles.modeSelectTrigger}
        aria-label="Research mode"
      >
        <span className={styles.modeSelectTriggerIcon}>
          <ResearchModeIcon mode={mode} />
        </span>
        <Select.Value className={styles.modeSelectValue}>
          {RESEARCH_MODES.find((item) => item.value === mode)?.label}
        </Select.Value>
        <Select.Icon className={styles.modeSelectChevron}>
          <ChevronDown size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          className={styles.modeSelectPositioner}
          sideOffset={6}
          alignItemWithTrigger={false}
        >
          <Select.Popup className={styles.modeSelectPopup}>
            <Select.List className={styles.modeSelectList}>
              {RESEARCH_MODES.map((item) => (
                <Select.Item
                  className={styles.modeSelectItem}
                  key={item.value}
                  value={item.value}
                  label={item.label}
                >
                  <span className={styles.modeSelectItemIcon}>
                    <ResearchModeIcon mode={item.value} size={16} />
                  </span>
                  <Select.ItemText className={styles.modeSelectItemText}>
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </Select.ItemText>
                  <Select.ItemIndicator className={styles.modeSelectIndicator}>
                    <Check size={14} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}
