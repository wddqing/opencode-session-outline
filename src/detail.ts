import { formatTime, type OutlineAction, type SessionMessage } from "./outline"

export type DetailKind = OutlineAction["kind"]

export interface DetailContent {
  readonly heading: string
  readonly meta: string
  readonly body: string
}

export interface DetailSelection extends DetailContent {
  readonly kind: DetailKind
  readonly sessionID: string
  readonly turnIndex?: number
  readonly totalTurns?: number
  readonly expectedMessages?: number
}

const MAX_BODY = 12_000
const MAX_STRING = 1_200

function truncate(text: string, maxLength = MAX_BODY): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}\n\n… output truncated`
}

function formatJson(value: unknown): string {
  const seen = new WeakSet<object>()
  try {
    const json = JSON.stringify(
      value,
      (_key, current: unknown) => {
        if (typeof current === "string" && current.length > MAX_STRING) {
          return `${current.slice(0, MAX_STRING)}…`
        }
        if (typeof current === "object" && current !== null) {
          if (seen.has(current)) return "[circular]"
          seen.add(current)
        }
        return current
      },
      2,
    )
    return json ?? String(value)
  } catch {
    return String(value)
  }
}

function toolContentText(content: readonly { type: string }[]): string {
  return content
    .map((item) => {
      if (item.type === "text" && "text" in item) return String(item.text)
      if (item.type === "file" && "mime" in item) {
        const name = "name" in item && typeof item.name === "string" ? item.name : "attachment"
        return `[file] ${name} (${String(item.mime)})`
      }
      return ""
    })
    .filter((text) => text.length > 0)
    .join("\n")
}

function toolBody(action: OutlineAction, message: SessionMessage): string {
  if (message.type !== "assistant") return "Tool call is not part of an assistant message."
  const part = message.content.find(
    (item): item is Extract<(typeof message.content)[number], { type: "tool" }> =>
      item.type === "tool" && item.id === action.partID,
  )
  if (!part) return "Tool call is not available in the loaded history."

  const state = part.state
  const lines = [`tool: ${part.name}`, `status: ${state.status}`]

  if (typeof state.input === "string") {
    lines.push("", "input (streaming):", state.input)
  } else {
    lines.push("", "input:", formatJson(state.input))
  }

  if (state.status === "error") {
    lines.push("", "error:", state.error.message)
  }
  if (state.status === "completed" || state.status === "error") {
    if (state.content?.length) lines.push("", "output:", toolContentText(state.content))
  }
  if (state.status !== "streaming" && state.metadata && Object.keys(state.metadata).length > 0) {
    lines.push("", "metadata:", formatJson(state.metadata))
  }

  return lines.join("\n")
}

function shellBody(message: SessionMessage): string {
  if (message.type !== "shell") return "Shell command is not available."
  const lines = [`$ ${message.command}`, `status: ${message.status}`]
  if (message.exit !== undefined) lines.push(`exit: ${message.exit}`)
  lines.push("", "output:", message.output?.output?.trim() || "(no output)")
  return lines.join("\n")
}

function compactionBody(message: SessionMessage): string {
  if (message.type !== "compaction") return "Compaction event is not available."
  const lines = [`status: ${message.status}`, `reason: ${message.reason}`]
  if (message.status === "failed") {
    lines.push("", "error:", message.error.message)
  } else {
    lines.push("", "summary:", message.summary.trim() || "(empty summary)")
  }
  return lines.join("\n")
}

function skillBody(message: SessionMessage): string {
  if (message.type !== "skill") return "Skill activation is not available."
  return [`skill: ${message.name}`, "", message.text.trim() || "(no skill text)"].join("\n")
}

function errorBody(action: OutlineAction, message: SessionMessage): string {
  const lines: string[] = []
  if (message.type === "assistant") {
    if (message.error) lines.push(`error: ${message.error.message}`, `type: ${message.error.type}`)
    if (message.retry) {
      lines.push(
        `retry: attempt ${message.retry.attempt}`,
        `retry error: ${message.retry.error.message}`,
      )
    }
    const text = message.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n")
      .trim()
    if (text) lines.push("", "assistant text:", text)
  } else if (message.type === "idle") {
    lines.push(`outcome: ${message.outcome}`)
    if (message.error) lines.push(`error: ${message.error.message}`, `type: ${message.error.type}`)
  }
  if (lines.length === 0) lines.push(action.detail ?? action.label)
  return lines.join("\n")
}

function messageBody(action: OutlineAction, message: SessionMessage): string {
  switch (action.kind) {
    case "tool":
      return toolBody(action, message)
    case "shell":
      return shellBody(message)
    case "compaction":
      return compactionBody(message)
    case "skill":
      return skillBody(message)
    case "error":
    case "interrupted":
      return errorBody(action, message)
  }
}

/** Builds the detail panel content for one outline action. */
export function buildDetail(action: OutlineAction, message: SessionMessage): DetailContent {
  return {
    heading: action.label,
    meta: `${action.kind} · ${formatTime(action.time)} · ${action.status}`,
    body: truncate(messageBody(action, message)),
  }
}
