import { createWriteStream } from "node:fs"
import { mkdir, readFile } from "node:fs/promises"
import { dirname } from "node:path"

/**
 * Append-only JSONL ledger, one line per terminal outcome. Resume replays the
 * file and skips anything already marked `done`. Kept deliberately dumb: no
 * database, no locking, safe to `tail -f` while a run is in flight.
 */
export class Ledger {
  #stream = null
  #path

  constructor(path) {
    this.#path = path
    this.records = new Map()
  }

  async open() {
    await mkdir(dirname(this.#path), { recursive: true })
    try {
      const existing = await readFile(this.#path, "utf8")
      for (const line of existing.split("\n")) {
        if (!line.trim()) continue
        try {
          const record = JSON.parse(line)
          if (record?.id) this.records.set(record.id, record)
        } catch {
          // A torn final line from a killed run; the id simply reprocesses.
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
    this.#stream = createWriteStream(this.#path, { flags: "a" })
    return this
  }

  isDone(id) {
    return this.records.get(id)?.status === "done"
  }

  attempts(id) {
    return this.records.get(id)?.attempts ?? 0
  }

  record(entry) {
    const previous = this.records.get(entry.id)
    const merged = {
      ...entry,
      attempts: (previous?.attempts ?? 0) + 1,
      at: new Date().toISOString(),
    }
    this.records.set(entry.id, merged)
    this.#stream.write(`${JSON.stringify(merged)}\n`)
    return merged
  }

  summary() {
    const counts = {}
    for (const record of this.records.values()) {
      counts[record.status] = (counts[record.status] ?? 0) + 1
    }
    return counts
  }

  async close() {
    await new Promise((resolve) => this.#stream.end(resolve))
  }
}
