import { create } from "zustand"

interface LandingUiState {
  approachStep: number
  mobileNavOpen: boolean
}

interface LandingUiActions {
  setApproachStep: (step: number) => void
  advanceApproachStep: (stepCount: number) => void
  setMobileNavOpen: (open: boolean) => void
  toggleMobileNav: () => void
  closeMobileNav: () => void
}

export const useLandingUiStore = create<LandingUiState & LandingUiActions>(
  (set) => ({
    approachStep: 0,
    mobileNavOpen: false,

    setApproachStep: (step) => set({ approachStep: Math.max(0, step) }),
    advanceApproachStep: (stepCount) =>
      set((state) => ({
        approachStep: (state.approachStep + 1) % Math.max(1, stepCount),
      })),
    setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
    toggleMobileNav: () =>
      set((state) => ({ mobileNavOpen: !state.mobileNavOpen })),
    closeMobileNav: () => set({ mobileNavOpen: false }),
  })
)
