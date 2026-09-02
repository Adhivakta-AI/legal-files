import type {
  PipelineStage,
  ResearchMode,
  StageStatus,
} from "@/lib/research/types"

export interface StageState {
  status: StageStatus
  message: string
  detail?: string
  elapsed_ms?: number
}

export type StageMap = Record<PipelineStage, StageState>

export interface StageMeta {
  id: PipelineStage
  index: string
  label: string
  idle: string
}

export const AI_PRO_STAGE_META: StageMeta[] = [
  { id: "spelling", index: "01", label: "SPELLING", idle: "Awaiting query" },
  {
    id: "acronyms",
    index: "02",
    label: "ACRONYMS",
    idle: "Awaiting normalization",
  },
  {
    id: "context",
    index: "03",
    label: "LEGAL CONTEXT",
    idle: "Awaiting classification",
  },
  {
    id: "retrieval",
    index: "04",
    label: "RETRIEVAL",
    idle: "Index standing by",
  },
  {
    id: "generation",
    index: "05",
    label: "GENERATION",
    idle: "Source lock enabled",
  },
]

export const SEARCH_STAGE_META: StageMeta[] = [
  { id: "spelling", index: "01", label: "SPELLING", idle: "Awaiting query" },
  {
    id: "retrieval",
    index: "02",
    label: "RETRIEVAL",
    idle: "Index standing by",
  },
]

export function stageMetaFor(mode: ResearchMode): StageMeta[] {
  return mode === "search" ? SEARCH_STAGE_META : AI_PRO_STAGE_META
}

export function initialStages(): StageMap {
  return Object.fromEntries(
    AI_PRO_STAGE_META.map((stage) => [
      stage.id,
      { status: "queued", message: stage.idle },
    ])
  ) as StageMap
}

export function restoredStages(): StageMap {
  return Object.fromEntries(
    AI_PRO_STAGE_META.map((stage) => [
      stage.id,
      { status: "complete", message: "Restored from research history" },
    ])
  ) as StageMap
}
