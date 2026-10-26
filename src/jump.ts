import type { Context } from "@opencode/plugin/tui/context"

export type JumpFailure = "timeout" | "cancelled"

export interface JumpResult {
  readonly ok: boolean
  readonly reason?: JumpFailure
}

export interface JumpInput {
  readonly sessionID: string
  /** 0-based index in the host's user-message navigation list. */
  readonly turnIndex: number
  readonly totalTurns: number
  /** Number of messages the host should have loaded before navigating. */
  readonly expectedMessages: number
  readonly stepMs?: number
  readonly loadTimeoutMs?: number
}

export interface JumpController {
  cancel(): void
  run(context: Context, input: JumpInput): Promise<JumpResult>
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForMessages(
  context: Context,
  sessionID: string,
  expected: number,
  timeoutMs: number,
  cancelled: () => boolean,
): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (cancelled()) return false
    if (context.data.session.message.list(sessionID).length >= expected) return true
    await sleep(100)
  }
  return false
}

/**
 * Creates a controller that serializes native turn jumps.
 *
 * OpenCode has no public message-scroll API. The controller uses the built-in
 * `session.first` and `session.message.user.next` commands, which the host
 * exposes through the keymap. Timing is deliberate: each command scrolls after
 * two animation frames, so a short pause keeps the sequence deterministic.
 */
export function createJumpController(): JumpController {
  let generation = 0

  return {
    cancel() {
      generation += 1
    },

    async run(context, input) {
      const current = ++generation
      const cancelled = () => current !== generation
      const stepMs = input.stepMs ?? 70

      // Jumping to the newest turn does not need to load the whole history.
      if (input.turnIndex === input.totalTurns - 1) {
        context.keymap.dispatch("session.messages_last_user")
        return { ok: true }
      }

      context.keymap.dispatch("session.first")
      const ready = await waitForMessages(
        context,
        input.sessionID,
        input.expectedMessages,
        input.loadTimeoutMs ?? 10_000,
        cancelled,
      )
      if (cancelled()) return { ok: false, reason: "cancelled" }
      if (!ready) return { ok: false, reason: "timeout" }

      // Let the host finish its post-load scroll to the top.
      await sleep(250)

      for (let index = 0; index <= input.turnIndex; index += 1) {
        if (cancelled()) return { ok: false, reason: "cancelled" }
        context.keymap.dispatch("session.message.user.next")
        await sleep(stepMs)
      }

      return { ok: true }
    },
  }
}
