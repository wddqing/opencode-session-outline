// 启动本文件测试：node --test test/jump.test.ts

import assert from "node:assert/strict"
import test from "node:test"
import type { Context } from "@opencode/plugin/tui/context"
import { createJumpController } from "../src/jump.ts"

function fakeContext(loaded: number): { context: Context; dispatched: string[] } {
  const dispatched: string[] = []
  const messages = Array.from({ length: loaded }, () => ({}))
  const context = {
    keymap: {
      dispatch: (id: string) => {
        dispatched.push(id)
      },
    },
    data: {
      session: {
        message: {
          list: () => messages,
        },
      },
    },
  } as unknown as Context
  return { context, dispatched }
}

// TestJumpMiddleTurn 验证从顶部逐条前进到目标轮次。
// 启动：node --test test/jump.test.ts --test-name-pattern TestJumpMiddleTurn
test("TestJumpMiddleTurn", async () => {
  const { context, dispatched } = fakeContext(10)
  const result = await createJumpController().run(context, {
    sessionID: "ses_test",
    turnIndex: 1,
    totalTurns: 3,
    expectedMessages: 10,
    stepMs: 0,
  })

  assert.equal(result.ok, true)
  assert.deepEqual(dispatched, [
    "session.first",
    "session.message.user.next",
    "session.message.user.next",
  ])
})

// TestJumpLastTurn 验证最后一轮直接跳到最近的用户消息。
// 启动：node --test test/jump.test.ts --test-name-pattern TestJumpLastTurn
test("TestJumpLastTurn", async () => {
  const { context, dispatched } = fakeContext(10)
  const result = await createJumpController().run(context, {
    sessionID: "ses_test",
    turnIndex: 2,
    totalTurns: 3,
    expectedMessages: 10,
    stepMs: 0,
  })

  assert.equal(result.ok, true)
  assert.deepEqual(dispatched, ["session.messages_last_user"])
})

// TestJumpTimeout 验证历史未加载完成时放弃跳转。
// 启动：node --test test/jump.test.ts --test-name-pattern TestJumpTimeout
test("TestJumpTimeout", async () => {
  const { context, dispatched } = fakeContext(1)
  const result = await createJumpController().run(context, {
    sessionID: "ses_test",
    turnIndex: 1,
    totalTurns: 4,
    expectedMessages: 20,
    stepMs: 0,
    loadTimeoutMs: 30,
  })

  assert.deepEqual(result, { ok: false, reason: "timeout" })
  assert.deepEqual(dispatched, ["session.first"])
})
