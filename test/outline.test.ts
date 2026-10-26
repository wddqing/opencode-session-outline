// 启动本文件测试：node --test test/outline.test.ts

import assert from "node:assert/strict"
import test from "node:test"
import {
  buildOutline,
  clip,
  displayWidth,
  mergeMessages,
  type SessionMessage,
} from "../src/outline.ts"

const cast = (value: Record<string, unknown>): SessionMessage => value as unknown as SessionMessage

const user = (id: string, text: string, created: number): SessionMessage =>
  cast({ id, type: "user", text, time: { created } })

const assistant = (
  id: string,
  created: number,
  content: Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {},
): SessionMessage =>
  cast({
    id,
    type: "assistant",
    time: { created },
    agent: "build",
    model: { providerID: "test", id: "test-model" },
    content,
    ...extra,
  })

const tool = (
  id: string,
  name: string,
  input: Record<string, unknown>,
  status: "completed" | "error" = "completed",
): Record<string, unknown> => ({
  type: "tool",
  id,
  name,
  time: { created: 10 },
  state:
    status === "error"
      ? { status, input, error: { type: "test", message: "boom" } }
      : { status, input, content: [{ type: "text", text: "ok" }] },
})

// TestBuildOutlineTurns 验证用户消息形成轮次并分配原生跳转序号。
// 启动：node --test test/outline.test.ts --test-name-pattern TestBuildOutlineTurns
test("TestBuildOutlineTurns", () => {
  const outline = buildOutline({
    messages: [
      user("user_1", "first prompt", 1),
      assistant("asst_1", 2, [tool("tool_1", "edit", { filePath: "src/a.ts" })]),
      user("user_2", "second prompt", 3),
    ],
  })

  assert.equal(outline.turns.length, 2)
  assert.equal(outline.turns[0].index, 1)
  assert.equal(outline.turns[0].jumpIndex, 0)
  assert.equal(outline.turns[0].title, "first prompt")
  assert.equal(outline.turns[0].actions.length, 1)
  assert.equal(outline.turns[0].editCount, 1)
  assert.equal(outline.turns[1].jumpIndex, 1)
  assert.deepEqual(outline.counts, { turns: 2, tools: 1, edits: 1, errors: 0 })
})

// TestBuildOutlineToolError 验证工具失败会标记轮次状态和错误计数。
// 启动：node --test test/outline.test.ts --test-name-pattern TestBuildOutlineToolError
test("TestBuildOutlineToolError", () => {
  const outline = buildOutline({
    messages: [
      user("user_1", "run it", 1),
      assistant("asst_1", 2, [tool("tool_1", "bash", { command: "false" }, "error")]),
    ],
  })

  assert.equal(outline.turns[0].status, "error")
  assert.equal(outline.turns[0].errorCount, 1)
  assert.equal(outline.turns[0].actions[0].status, "error")
  assert.equal(outline.turns[0].actions[0].detail, "boom")
})

// TestBuildOutlineShellExit 验证非零退出码的 shell 消息被标记为失败。
// 启动：node --test test/outline.test.ts --test-name-pattern TestBuildOutlineShellExit
test("TestBuildOutlineShellExit", () => {
  const outline = buildOutline({
    messages: [
      user("user_1", "shell", 1),
      cast({
        id: "shell_1",
        type: "shell",
        shellID: "shell",
        command: "false",
        status: "exited",
        exit: 1,
        time: { created: 2 },
      }),
    ],
  })

  assert.equal(outline.turns[0].actions[0].kind, "shell")
  assert.equal(outline.turns[0].actions[0].status, "error")
  assert.equal(outline.turns[0].errorCount, 1)
})

// TestBuildOutlineCompaction 验证压缩事件作为轮次内的操作出现。
// 启动：node --test test/outline.test.ts --test-name-pattern TestBuildOutlineCompaction
test("TestBuildOutlineCompaction", () => {
  const outline = buildOutline({
    messages: [
      user("user_1", "compact", 1),
      cast({
        id: "compact_1",
        type: "compaction",
        status: "completed",
        reason: "auto",
        summary: "summary",
        time: { created: 2 },
      }),
    ],
  })

  assert.equal(outline.turns[0].actions[0].kind, "compaction")
  assert.equal(outline.turns[0].actions[0].status, "info")
})

// TestBuildOutlineSyntheticStart 验证首条用户消息之前的内容归入不可跳转的起始轮次。
// 启动：node --test test/outline.test.ts --test-name-pattern TestBuildOutlineSyntheticStart
test("TestBuildOutlineSyntheticStart", () => {
  const outline = buildOutline({
    messages: [
      cast({
        id: "shell_1",
        type: "shell",
        shellID: "shell",
        command: "pwd",
        status: "exited",
        exit: 0,
        time: { created: 1 },
      }),
      user("user_1", "hello", 2),
    ],
  })

  assert.equal(outline.turns.length, 2)
  assert.equal(outline.turns[0].jumpIndex, undefined)
  assert.equal(outline.turns[1].jumpIndex, 0)
  assert.equal(outline.counts.turns, 1)
})

// TestBuildOutlineInterrupted 验证中断的 idle 事件改变轮次状态但不计入错误数。
// 启动：node --test test/outline.test.ts --test-name-pattern TestBuildOutlineInterrupted
test("TestBuildOutlineInterrupted", () => {
  const outline = buildOutline({
    messages: [
      user("user_1", "stop", 1),
      cast({ id: "idle_1", type: "idle", outcome: "interrupted", time: { created: 2 } }),
    ],
  })

  assert.equal(outline.turns[0].status, "interrupted")
  assert.equal(outline.turns[0].errorCount, 0)
})

// TestBuildOutlineActionCap 验证单轮操作超过上限时保留计数并记录截断数量。
// 启动：node --test test/outline.test.ts --test-name-pattern TestBuildOutlineActionCap
test("TestBuildOutlineActionCap", () => {
  const content = Array.from({ length: 35 }, (_value, index) =>
    tool(`tool_${index}`, "read", { filePath: `src/${index}.ts` }),
  )
  const outline = buildOutline({
    messages: [user("user_1", "many tools", 1), assistant("asst_1", 2, content)],
    maxActionsPerTurn: 30,
  })

  assert.equal(outline.turns[0].actions.length, 30)
  assert.equal(outline.turns[0].truncatedActions, 5)
  assert.equal(outline.turns[0].toolCount, 35)
  assert.equal(outline.counts.tools, 35)
})

// TestMergeMessages 验证按 id 去重、优先使用实时消息并按时间排序。
// 启动：node --test test/outline.test.ts --test-name-pattern TestMergeMessages
test("TestMergeMessages", () => {
  const history = [user("user_1", "old", 1), user("user_2", "history", 3)]
  const live = [
    user("user_2", "live", 3),
    user("user_3", "new", 4),
  ]
  const merged = mergeMessages(history, live)

  assert.deepEqual(
    merged.map((message) => message.id),
    ["user_1", "user_2", "user_3"],
  )
  assert.equal(merged[1].type === "user" ? merged[1].text : "", "live")
})

// TestClipWidth 验证 CJK 字符按双宽计算并在超出预算时截断。
// 启动：node --test test/outline.test.ts --test-name-pattern TestClipWidth
test("TestClipWidth", () => {
  assert.equal(displayWidth("ab"), 2)
  assert.equal(displayWidth("中文"), 4)
  assert.equal(clip("中文中文", 5), "中文…")
  assert.equal(clip("abcdef", 4), "abc…")
})
