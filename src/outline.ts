import type { Context } from "@opencode/plugin/tui/context"

/**
 * The message shape exposed by the TUI client store.
 *
 * Importing the SDK type directly through the plugin context keeps this module
 * independent from `@opencode/client` while still tracking the host schema.
 */
export type SessionMessage = ReturnType<Context["data"]["session"]["message"]["list"]>[number]

type UserMessage = Extract<SessionMessage, { type: "user" }>
type AssistantMessage = Extract<SessionMessage, { type: "assistant" }>
type ToolPart = Extract<AssistantMessage["content"][number], { type: "tool" }>
type ShellMessage = Extract<SessionMessage, { type: "shell" }>
type CompactionMessage = Extract<SessionMessage, { type: "compaction" }>
type SkillMessage = Extract<SessionMessage, { type: "skill" }>

export type OutlineActionKind =
  | "tool"
  | "shell"
  | "compaction"
  | "skill"
  | "error"
  | "interrupted"

export type OutlineActionStatus = "running" | "completed" | "error" | "info"

export interface OutlineAction {
  /** Stable key used by the sidebar renderer. */
  readonly id: string
  readonly kind: OutlineActionKind
  /** Message that owns this action and is used as the native jump target. */
  readonly messageID: string
  /** Tool call part id, when the action comes from assistant content. */
  readonly partID?: string
  /** Tool name for tool actions, used to pick the row icon. */
  readonly tool?: string
  readonly label: string
  readonly detail?: string
  readonly status: OutlineActionStatus
  readonly time: number
  /** True for operations that modify files. */
  readonly edit: boolean
}

export interface OutlineTurn {
  readonly id: string
  /** 1-based display index. */
  index: number
  /** 0-based index in the host's user-message navigation list, when jumpable. */
  jumpIndex?: number
  readonly messageID: string
  readonly time: number
  readonly title: string
  readonly actions: OutlineAction[]
  toolCount: number
  editCount: number
  errorCount: number
  /** Actions dropped because the per-turn cap was reached. */
  truncatedActions: number
  status: "running" | "completed" | "error" | "interrupted"
}

export interface OutlineCounts {
  readonly turns: number
  readonly tools: number
  readonly edits: number
  readonly errors: number
}

export interface Outline {
  readonly turns: OutlineTurn[]
  readonly counts: OutlineCounts
}

export interface BuildOutlineInput {
  /** Messages ordered from oldest to newest. */
  readonly messages: readonly SessionMessage[]
  /** Whether the session is currently running. */
  readonly running?: boolean
  /** Upper bound for actions rendered per turn. Counts still include all actions. */
  readonly maxActionsPerTurn?: number
}

const DEFAULT_MAX_ACTIONS = 30

const EDIT_TOOLS = new Set(["edit", "write", "patch", "apply_patch", "multiedit", "str_replace_editor"])

const TOOL_ICONS: Record<string, string> = {
  read: "◇",
  edit: "✎",
  write: "✎",
  patch: "✎",
  bash: "▶",
  shell: "▶",
  grep: "⌕",
  glob: "⌕",
  webfetch: "⇣",
  websearch: "⌕",
  task: "↳",
  question: "?",
  todowrite: "☑",
}

export const ACTION_ICONS: Record<OutlineActionKind, string> = {
  tool: "⚙",
  shell: "▶",
  compaction: "⊟",
  skill: "✦",
  error: "✗",
  interrupted: "■",
}

export function toolIcon(name: string): string {
  return TOOL_ICONS[name.toLowerCase()] ?? "⚙"
}

const TOOL_SUMMARY_KEYS: Record<string, readonly string[]> = {
  read: ["filePath", "path"],
  edit: ["filePath", "path"],
  write: ["filePath", "path"],
  patch: ["filePath", "path"],
  bash: ["command"],
  shell: ["command"],
  grep: ["pattern"],
  glob: ["pattern"],
  webfetch: ["url"],
  websearch: ["query"],
  task: ["description", "prompt"],
  question: ["question"],
}

const FALLBACK_SUMMARY_KEYS = [
  "filePath",
  "path",
  "command",
  "pattern",
  "url",
  "description",
  "query",
  "name",
] as const

function firstString(input: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return undefined
}

/** Returns the first display line of a block of text. */
export function firstLine(text: string): string {
  return text.replace(/\r\n?/g, "\n").split("\n").find((line) => line.trim())?.trim() ?? ""
}

const WIDE_CHAR =
  /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/

function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0
  if (code >= 0x1f300 && code <= 0x1faff) return 2
  return WIDE_CHAR.test(char) ? 2 : 1
}

/** Estimates terminal cell width, counting CJK and emoji as two cells. */
export function displayWidth(text: string): number {
  let width = 0
  for (const char of text) width += charWidth(char)
  return width
}

/** Clips one line to a terminal cell budget and appends an ellipsis. */
export function clip(text: string, maxWidth: number): string {
  const line = text.replace(/\s+/g, " ").trim()
  if (maxWidth <= 0) return ""
  if (displayWidth(line) <= maxWidth) return line
  let out = ""
  let width = 0
  for (const char of line) {
    const next = width + charWidth(char)
    if (next > maxWidth - 1) break
    out += char
    width = next
  }
  return `${out}…`
}

/** Formats a millisecond timestamp as local HH:MM. */
export function formatTime(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function summarizeTool(name: string, input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined
  return firstString(input, TOOL_SUMMARY_KEYS[name.toLowerCase()] ?? FALLBACK_SUMMARY_KEYS)
}

function createTurn(message: UserMessage, jumpIndex: number): OutlineTurn {
  return {
    id: message.id,
    index: 0,
    jumpIndex,
    messageID: message.id,
    time: message.time.created,
    title: clip(firstLine(message.text) || "(empty prompt)", 120),
    actions: [],
    toolCount: 0,
    editCount: 0,
    errorCount: 0,
    truncatedActions: 0,
    status: "completed",
  }
}

function createSyntheticTurn(message: SessionMessage): OutlineTurn {
  return {
    id: `start:${message.id}`,
    index: 0,
    messageID: message.id,
    time: message.time.created,
    title: "(session start)",
    actions: [],
    toolCount: 0,
    editCount: 0,
    errorCount: 0,
    truncatedActions: 0,
    status: "completed",
  }
}

function toolStatus(part: ToolPart): OutlineActionStatus {
  if (part.state.status === "error") return "error"
  if (part.state.status === "completed") return "completed"
  return "running"
}

function toolAction(message: AssistantMessage, part: ToolPart): OutlineAction {
  const state = part.state
  const input = typeof state.input === "string" ? undefined : state.input
  const summary = summarizeTool(part.name, input)
  const label = summary ? `${part.name} ${summary}` : part.name
  const detail =
    state.status === "error"
      ? state.error.message
      : input && typeof input.description === "string" && input.description.trim()
        ? input.description.trim()
        : undefined

  return {
    id: `tool:${message.id}:${part.id}`,
    kind: "tool",
    messageID: message.id,
    partID: part.id,
    tool: part.name,
    label,
    detail,
    status: toolStatus(part),
    time: part.time.created,
    edit: EDIT_TOOLS.has(part.name.toLowerCase()),
  }
}

function shellAction(message: ShellMessage): OutlineAction {
  const exitCode =
    typeof message.exit === "number"
      ? message.exit
      : message.exit === undefined
        ? undefined
        : Number(message.exit)
  const failed =
    message.status === "killed" ||
    message.status === "timeout" ||
    (message.status === "exited" && exitCode !== undefined && exitCode !== 0)

  return {
    id: `shell:${message.id}`,
    kind: "shell",
    messageID: message.id,
    label: `$ ${message.command}`,
    detail: message.exit === undefined ? undefined : `exit ${message.exit}`,
    status: message.status === "running" ? "running" : failed ? "error" : "completed",
    time: message.time.created,
    edit: false,
  }
}

function compactionAction(message: CompactionMessage): OutlineAction {
  const label =
    message.status === "running"
      ? "Compacting context…"
      : message.status === "failed"
        ? "Compaction failed"
        : "Context compacted"

  return {
    id: `compaction:${message.id}`,
    kind: "compaction",
    messageID: message.id,
    label,
    detail:
      message.status === "failed"
        ? message.error.message
        : message.status === "completed"
          ? message.reason
          : undefined,
    status: message.status === "running" ? "running" : message.status === "failed" ? "error" : "info",
    time: message.time.created,
    edit: false,
  }
}

function skillAction(message: SkillMessage): OutlineAction {
  return {
    id: `skill:${message.id}`,
    kind: "skill",
    messageID: message.id,
    label: `Skill: ${message.name}`,
    status: "info",
    time: message.time.created,
    edit: false,
  }
}

function assistantErrorActions(message: AssistantMessage): OutlineAction[] {
  const actions: OutlineAction[] = []
  if (message.retry) {
    actions.push({
      id: `retry:${message.id}`,
      kind: "error",
      messageID: message.id,
      label: `Retry ${message.retry.attempt}: ${message.retry.error.message}`,
      detail: message.retry.error.type,
      status: "running",
      time: message.retry.at,
      edit: false,
    })
  }
  if (message.error) {
    actions.push({
      id: `error:${message.id}`,
      kind: "error",
      messageID: message.id,
      label: `Error: ${message.error.message}`,
      detail: message.error.type,
      status: "error",
      time: message.time.completed ?? message.time.created,
      edit: false,
    })
  }
  return actions
}

/** Builds the sidebar outline from an ordered message list. */
export function buildOutline(input: BuildOutlineInput): Outline {
  const turns: OutlineTurn[] = []
  const interrupted = new Set<string>()
  const states = new Map<string, { running: boolean; error: boolean }>()
  const maxActions = input.maxActionsPerTurn ?? DEFAULT_MAX_ACTIONS
  let nextJumpIndex = 0

  const current = (message: SessionMessage): OutlineTurn => {
    const existing = turns.at(-1)
    if (existing) return existing
    const synthetic = createSyntheticTurn(message)
    turns.push(synthetic)
    return synthetic
  }

  const addAction = (turn: OutlineTurn, action: OutlineAction): void => {
    if (action.kind === "tool" || action.kind === "shell") turn.toolCount += 1
    if (action.edit) turn.editCount += 1
    if (action.status === "error") turn.errorCount += 1
    if (action.kind === "interrupted") interrupted.add(turn.id)

    const state = states.get(turn.id) ?? { running: false, error: false }
    if (action.status === "running") state.running = true
    if (action.status === "error") state.error = true
    states.set(turn.id, state)

    if (turn.actions.length < maxActions) turn.actions.push(action)
    else turn.truncatedActions += 1
  }

  for (const message of input.messages) {
    switch (message.type) {
      case "user": {
        if (!message.text.trim()) break
        const turn = createTurn(message, nextJumpIndex)
        nextJumpIndex += 1
        turns.push(turn)
        break
      }
      case "assistant": {
        const turn = current(message)
        for (const part of message.content) {
          if (part.type === "tool") addAction(turn, toolAction(message, part))
        }
        for (const action of assistantErrorActions(message)) addAction(turn, action)
        break
      }
      case "shell": {
        addAction(current(message), shellAction(message))
        break
      }
      case "compaction": {
        addAction(current(message), compactionAction(message))
        break
      }
      case "skill": {
        addAction(current(message), skillAction(message))
        break
      }
      case "idle": {
        const turn = turns.at(-1)
        if (!turn) break
        if (message.outcome === "interrupted") {
          addAction(turn, {
            id: `interrupted:${message.id}`,
            kind: "interrupted",
            messageID: message.id,
            label: "Turn interrupted",
            status: "info",
            time: message.time.created,
            edit: false,
          })
        } else if (message.outcome === "failed") {
          addAction(turn, {
            id: `failure:${message.id}`,
            kind: "error",
            messageID: message.id,
            label: message.error ? `Turn failed: ${message.error.message}` : "Turn failed",
            detail: message.error?.type,
            status: "error",
            time: message.time.created,
            edit: false,
          })
        }
        break
      }
    }
  }

  turns.forEach((turn, index) => {
    turn.index = index + 1
    const state = states.get(turn.id)
    turn.status = state?.error
      ? "error"
      : interrupted.has(turn.id)
        ? "interrupted"
        : state?.running || (input.running === true && index === turns.length - 1)
          ? "running"
          : "completed"
  })

  const counts = turns.reduce(
    (total, turn) => ({
      turns: total.turns + (turn.jumpIndex === undefined ? 0 : 1),
      tools: total.tools + turn.toolCount,
      edits: total.edits + turn.editCount,
      errors: total.errors + turn.errorCount,
    }),
    { turns: 0, tools: 0, edits: 0, errors: 0 },
  )

  return { turns, counts }
}

/**
 * Merges the full session history fetched by the plugin with the reactive
 * client store (which contains live streaming updates for loaded messages).
 */
export function mergeMessages(
  history: readonly SessionMessage[],
  live: readonly SessionMessage[],
): SessionMessage[] {
  const liveByID = new Map(live.map((message) => [message.id, message]))
  const merged: SessionMessage[] = []
  const seen = new Set<string>()

  for (const message of history) {
    merged.push(liveByID.get(message.id) ?? message)
    seen.add(message.id)
  }
  for (const message of live) {
    if (seen.has(message.id)) continue
    merged.push(message)
    seen.add(message.id)
  }

  merged.sort((left, right) => left.time.created - right.time.created)
  return merged
}

export interface FetchMessagesOptions {
  /** Page size sent to the session message endpoint. */
  readonly pageSize?: number
  /** Safety cap for very large sessions. */
  readonly maxPages?: number
}

/** Fetches the complete message history using cursor pagination. */
export async function fetchAllMessages(
  client: Context["client"],
  sessionID: string,
  options: FetchMessagesOptions = {},
): Promise<SessionMessage[]> {
  const pageSize = options.pageSize ?? 200
  const maxPages = options.maxPages ?? 100
  const messages: SessionMessage[] = []
  const seen = new Set<string>()
  let cursor: string | undefined

  for (let page = 0; page < maxPages; page += 1) {
    const response = await client.message.list({
      sessionID,
      limit: pageSize,
      ...(cursor === undefined ? { order: "asc" as const } : {}),
      cursor,
    })

    for (const message of response.data) {
      if (seen.has(message.id)) continue
      seen.add(message.id)
      messages.push(message)
    }

    const next = response.cursor.next ?? undefined
    if (!next || next === cursor) break
    cursor = next
  }

  messages.sort((left, right) => left.time.created - right.time.created)
  return messages
}
