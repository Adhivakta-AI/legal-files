import "server-only"

import { getCloudflareContext } from "@opennextjs/cloudflare"

export function cloudflareEnv(): CloudflareEnv {
  return getCloudflareContext().env
}

export function serverSetting(name: keyof CloudflareEnv): string | undefined {
  const processValue = process.env[name]
  if (processValue?.trim()) return processValue.trim()
  try {
    const binding = cloudflareEnv()[name]
    return typeof binding === "string" && binding.trim() ? binding.trim() : undefined
  } catch {
    return undefined
  }
}

export function requiredServerSetting(name: keyof CloudflareEnv): string {
  const value = serverSetting(name)
  if (!value) throw new Error(`${String(name)} is required`)
  return value
}
