import fs from "node:fs/promises"

import { scoreEvaluation } from "./metrics.mjs"

function parseJsonLines(text, name) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line, index) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error(
          `${name}:${index + 1}: ${error instanceof Error ? error.message : "invalid JSON"}`
        )
      }
    })
}

const [casePath, runPath] = process.argv.slice(2)
if (!casePath || !runPath) {
  console.error(
    "Usage: node evaluation/score.mjs <lawyer-reviewed-cases.jsonl> <reviewed-runs.jsonl>"
  )
  process.exitCode = 1
} else {
  const [caseText, runText] = await Promise.all([
    fs.readFile(casePath, "utf8"),
    fs.readFile(runPath, "utf8"),
  ])
  const report = scoreEvaluation(
    parseJsonLines(caseText, casePath),
    parseJsonLines(runText, runPath)
  )
  console.log(JSON.stringify(report, null, 2))
}
