"use client"

import { Toaster } from "sonner"
import { useTheme } from "next-themes"

export function ThemedToaster() {
  const { resolvedTheme } = useTheme()

  return (
    <Toaster
      theme={resolvedTheme === "light" ? "light" : "dark"}
      position="bottom-right"
      closeButton
      visibleToasts={4}
      toastOptions={{
        duration: 4200,
      }}
    />
  )
}
