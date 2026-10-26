import { Index, Show, createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import type { Store } from "solid-js/store"
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import type { Context, PanelInput } from "@opencode/plugin/tui/context"
import { buildDetail, type DetailSelection } from "./detail"
import { createJumpController, type JumpController } from "./jump"
import {
  ACTION_ICONS,
  buildOutline,
  clip,
  fetchAllMessages,
  formatTime,
  mergeMessages,
  toolIcon,
  type Outline,
  type OutlineAction,
  type OutlineTurn,
  type SessionMessage,
} from "./outline"

const PANEL_NAME = "opencode.session-outline.detail"
const INITIAL_TURNS = 50
const TURN_PAGE = 50
const THROTTLE_MS = 150

type SelectionStore = Store<{ current: DetailSelection | null }>

interface OutlinePluginProps {
  readonly sessionID: string
  readonly select: (value: DetailSelection | null) => void
  readonly jump: JumpController
  readonly stepMs: number
}

function actionColor(context: Context, action: OutlineAction) {
  if (action.status === "error") return context.theme.text.feedback.error.base
  if (action.status === "running") return context.theme.text.feedback.warning.base
  if (action.edit) return context.theme.text.feedback.success.base
  return context.theme.text.muted
}

function turnColor(context: Context, turn: OutlineTurn) {
  if (turn.status === "error") return context.theme.text.feedback.error.base
  if (turn.status === "running" || turn.status === "interrupted") {
    return context.theme.text.feedback.warning.base
  }
  return context.theme.text.base
}

function TurnRow(props: {
  turn: OutlineTurn
  expanded: boolean
  onToggle: () => void
  onJump: () => void
}) {
  const context = usePlugin()
  const [hover, setHover] = createSignal(false)

  return (
    <box
      flexDirection="row"
      height={1}
      backgroundColor={hover() ? context.theme.background.raised.base : undefined}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
    >
      <text fg={context.theme.text.muted} onMouseUp={props.onToggle}>
        {props.expanded ? "▾ " : "▸ "}
      </text>
      <text fg={context.theme.text.faint}>{`#${props.turn.index} `}</text>
      <text fg={context.theme.text.faint}>{`${formatTime(props.turn.time)} `}</text>
      <box flexGrow={1} onMouseUp={props.onJump}>
        <text fg={turnColor(context, props.turn)} wrapMode="none">
          {clip(props.turn.title, 20)}
        </text>
      </box>
      <Show when={props.turn.errorCount > 0}>
        <text fg={context.theme.text.feedback.error.base}>{`✗${props.turn.errorCount}`}</text>
      </Show>
    </box>
  )
}

function ActionRow(props: { action: OutlineAction; onOpen: () => void }) {
  const context = usePlugin()
  const [hover, setHover] = createSignal(false)
  const icon = () =>
    props.action.kind === "tool" ? toolIcon(props.action.tool ?? "") : ACTION_ICONS[props.action.kind]

  return (
    <box
      flexDirection="row"
      height={1}
      paddingLeft={2}
      backgroundColor={hover() ? context.theme.background.raised.base : undefined}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
    >
      <text fg={actionColor(context, props.action)}>{`${icon()} `}</text>
      <box flexGrow={1} onMouseUp={props.onOpen}>
        <text fg={actionColor(context, props.action)} wrapMode="none">
          {clip(props.action.label, 28)}
        </text>
      </box>
    </box>
  )
}

function SidebarOutline(props: OutlinePluginProps) {
  const context = usePlugin()
  const [history, setHistory] = createSignal<SessionMessage[]>([])
  const [version, setVersion] = createSignal(0)
  const [open, setOpen] = createSignal(true)
  const [limit, setLimit] = createSignal(INITIAL_TURNS)
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  let loadGeneration = 0
  let throttle: ReturnType<typeof setTimeout> | undefined

  const messages = (): SessionMessage[] =>
    mergeMessages(history(), context.data.session.message.list(props.sessionID) ?? [])

  const schedule = () => {
    if (throttle !== undefined) return
    throttle = setTimeout(() => {
      throttle = undefined
      setVersion((value) => value + 1)
    }, THROTTLE_MS)
  }

  const outline = createMemo<Outline>(() => {
    version()
    return buildOutline({
      messages: untrack(messages),
      running: untrack(() => context.data.session.status(props.sessionID)) === "running",
    })
  })

  const visible = createMemo(() => {
    const all = outline().turns
    const hidden = Math.max(0, all.length - limit())
    return { turns: hidden > 0 ? all.slice(hidden) : all, hidden }
  })

  const totalJumpable = () =>
    outline().turns.reduce((total, turn) => total + (turn.jumpIndex === undefined ? 0 : 1), 0)

  const totalMessages = () => messages().length

  createEffect(() => {
    context.data.session.message.list(props.sessionID)
    context.data.session.status(props.sessionID)
    schedule()
  })

  const stopListening = context.data.listen(({ details }) => {
    const data = (details as { data?: { sessionID?: unknown } }).data
    if (typeof data?.sessionID === "string" && data.sessionID === props.sessionID) schedule()
  })
  onCleanup(stopListening)

  createEffect(
    on(
      () => props.sessionID,
      (sessionID) => {
        void load(sessionID)
      },
    ),
  )

  onCleanup(() => {
    loadGeneration += 1
    props.jump.cancel()
    if (throttle !== undefined) clearTimeout(throttle)
  })

  async function load(sessionID: string) {
    const generation = ++loadGeneration
    setHistory([])
    setOpen(true)
    setLimit(INITIAL_TURNS)
    setExpanded(new Set<string>())
    setError(null)
    setVersion((value) => value + 1)

    try {
      await context.data.session.message.sync(sessionID)
    } catch {
      // The live store still drives the outline when a full sync is unavailable.
    }

    try {
      const all = await fetchAllMessages(context.client, sessionID)
      if (generation !== loadGeneration) return
      setHistory(all)
      setVersion((value) => value + 1)
    } catch (cause) {
      if (generation !== loadGeneration) return
      setError("History unavailable")
      console.error("session-outline: failed to load message history", cause)
    }
  }

  function toggleTurn(turn: OutlineTurn) {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(turn.id)) next.delete(turn.id)
      else next.add(turn.id)
      return next
    })
  }

  async function jumpTurn(turn: OutlineTurn) {
    if (turn.jumpIndex === undefined || busy()) return
    setBusy(true)
    const result = await props.jump.run(context, {
      sessionID: props.sessionID,
      turnIndex: turn.jumpIndex,
      totalTurns: totalJumpable(),
      expectedMessages: totalMessages(),
      stepMs: props.stepMs,
    })
    setBusy(false)
    if (!result.ok && result.reason === "timeout") {
      context.ui.toast.show({
        title: "Session outline",
        message: "Session history is still loading; jump cancelled",
        variant: "error",
      })
    }
  }

  function openAction(turn: OutlineTurn, action: OutlineAction) {
    const all = messages()
    const message = all.find((item) => item.id === action.messageID)
    if (!message) return
    const detail = buildDetail(action, message)
    props.select({
      ...detail,
      kind: action.kind,
      sessionID: props.sessionID,
      turnIndex: turn.jumpIndex,
      totalTurns: totalJumpable(),
      expectedMessages: all.length,
    })
    if (!context.ui.panel.open(PANEL_NAME)) {
      context.ui.toast.show({
        message: "Open a session to inspect this item",
        variant: "error",
      })
    }
  }

  return (
    <box flexDirection="column" gap={0} paddingBottom={1}>
      <box flexDirection="row" gap={1} height={1} onMouseUp={() => setOpen(!open())}>
        <text fg={context.theme.text.base}>{open() ? "▼" : "▶"}</text>
        <text fg={context.theme.text.base}>
          <b>Session Outline</b>
        </text>
      </box>

      <Show when={open()}>
        <text fg={context.theme.text.muted}>
          {`${outline().counts.turns} turns · ${outline().counts.tools} tools · ${outline().counts.errors} errors`}
        </text>

        <Show when={error()}>
          <text fg={context.theme.text.feedback.error.base}>{error()}</text>
        </Show>

        <Show when={busy()}>
          <text fg={context.theme.text.feedback.warning.base}>Locating turn…</text>
        </Show>

        <Show when={visible().hidden > 0}>
          <text
            fg={context.theme.text.feedback.info.base}
            onMouseUp={() => setLimit((value) => value + TURN_PAGE)}
          >
            {`… ${visible().hidden} earlier turns`}
          </text>
        </Show>

        <Index each={visible().turns}>
          {(turn) => (
            <>
              <TurnRow
                turn={turn()}
                expanded={expanded().has(turn().id)}
                onToggle={() => toggleTurn(turn())}
                onJump={() => void jumpTurn(turn())}
              />
              <Show when={expanded().has(turn().id)}>
                <Index each={turn().actions}>
                  {(action) => (
                    <ActionRow action={action()} onOpen={() => openAction(turn(), action())} />
                  )}
                </Index>
                <Show when={turn().truncatedActions > 0}>
                  <text fg={context.theme.text.faint} paddingLeft={2}>
                    {`… ${turn().truncatedActions} more actions`}
                  </text>
                </Show>
              </Show>
            </>
          )}
        </Index>

        <Show when={outline().turns.length === 0 && !error()}>
          <text fg={context.theme.text.muted}>No messages yet</text>
        </Show>
      </Show>
    </box>
  )
}

function DetailPanel(props: {
  panel: PanelInput
  selection: SelectionStore
  jump: JumpController
  stepMs: number
}) {
  const context = usePlugin()
  const [busy, setBusy] = createSignal(false)

  const current = () => {
    const value = props.selection.current
    return value && value.sessionID === props.panel.sessionID ? value : null
  }

  async function jumpToTurn() {
    const value = current()
    if (!value || value.turnIndex === undefined || busy()) return
    setBusy(true)

    // The session.panel owns input while open, which makes the host's session
    // navigation commands unreachable. Close it first so the transcript can
    // receive the jump sequence.
    props.panel.close()
    await new Promise((resolve) => setTimeout(resolve, 60))

    const result = await props.jump.run(context, {
      sessionID: props.panel.sessionID,
      turnIndex: value.turnIndex,
      totalTurns: value.totalTurns ?? value.turnIndex + 1,
      expectedMessages: value.expectedMessages ?? 0,
      stepMs: props.stepMs,
    })
    setBusy(false)
    if (!result.ok && result.reason === "timeout") {
      context.ui.toast.show({
        title: "Session outline",
        message: "Session history is still loading; jump cancelled",
        variant: "error",
      })
    }
  }

  return (
    <Show
      when={current()}
      fallback={
        <box padding={1}>
          <text fg={context.theme.text.muted}>Select an action in the session outline.</text>
        </box>
      }
    >
      {(value) => (
        <box flexDirection="column" height="100%" padding={1} gap={1}>
          <box flexDirection="column" gap={0}>
            <text fg={context.theme.text.base} wrapMode="char">
              <b>{value().heading}</b>
            </text>
            <text fg={context.theme.text.muted} wrapMode="char">
              {value().meta}
            </text>
          </box>

          <scrollbox flexGrow={1} minHeight={0}>
            <text fg={context.theme.text.base} wrapMode="char">
              {value().body}
            </text>
          </scrollbox>

          <box flexDirection="row" gap={2} height={1}>
            <Show when={value().turnIndex !== undefined}>
              <text
                fg={context.theme.text.feedback.info.base}
                onMouseUp={() => void jumpToTurn()}
              >
                {busy() ? "Locating…" : "↑ Jump to turn"}
              </text>
            </Show>
            <text fg={context.theme.text.muted} onMouseUp={() => props.panel.close()}>
              Close
            </text>
          </box>
        </box>
      )}
    </Show>
  )
}

export default Plugin.define({
  id: "opencode.session-outline",
  setup(context) {
    const [selection, setSelection] = context.storage.memory<{ current: DetailSelection | null }>(
      "selection",
      { initial: { current: null } },
    )
    const jump = createJumpController()
    const stepMs =
      typeof context.options.jumpStepMs === "number" && context.options.jumpStepMs > 0
        ? context.options.jumpStepMs
        : 70

    const select = (value: DetailSelection | null) => {
      setSelection((draft) => {
        draft.current = value
      })
    }

    context.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID }) => (
        <SidebarOutline
          sessionID={sessionID}
          select={select}
          jump={jump}
          stepMs={stepMs}
        />
      ),
    })

    context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === PANEL_NAME}>
          <DetailPanel panel={panel} selection={selection} jump={jump} stepMs={stepMs} />
        </Show>
      ),
    })
  },
})
