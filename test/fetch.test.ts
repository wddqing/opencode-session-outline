// 启动本文件测试：node --test test/fetch.test.ts

import assert from "node:assert/strict"
import test from "node:test"
import type { Context } from "@opencode/plugin/tui/context"
import { fetchAllMessages, type SessionMessage } from "../src/outline.ts"

const user = (id: string, created: number): SessionMessage =>
  ({ id, type: "user", text: id, time: { created } }) as unknown as SessionMessage

// TestFetchAllMessagesPagination 验证首页带 order，后续页只带 cursor。
// 启动：node --test test/fetch.test.ts --test-name-pattern TestFetchAllMessagesPagination
test("TestFetchAllMessagesPagination", async () => {
  const calls: Array<Record<string, unknown>> = []
  const client = {
    message: {
      list: async (input: Record<string, unknown>) => {
        calls.push(input)
        if (input.cursor === undefined) {
          return { data: [user("m1", 1), user("m2", 2)], cursor: { next: "page-2" } }
        }
        if (input.cursor === "page-2") {
          return { data: [user("m3", 3)], cursor: { next: null } }
        }
        throw new Error(`unexpected cursor: ${String(input.cursor)}`)
      },
    },
  } as unknown as Context["client"]

  const messages = await fetchAllMessages(client, "ses_test")
  assert.deepEqual(
    messages.map((message) => message.id),
    ["m1", "m2", "m3"],
  )
  assert.equal(calls.length, 2)
  assert.equal(calls[0].order, "asc")
  assert.equal(calls[0].cursor, undefined)
  assert.equal(calls[1].order, undefined)
  assert.equal(calls[1].cursor, "page-2")
})

// TestFetchAllMessagesDeduplicates 验证重复分页数据按 id 去重。
// 启动：node --test test/fetch.test.ts --test-name-pattern TestFetchAllMessagesDeduplicates
test("TestFetchAllMessagesDeduplicates", async () => {
  let page = 0
  const client = {
    message: {
      list: async () => {
        page += 1
        if (page === 1) {
          return { data: [user("m1", 1), user("m2", 2)], cursor: { next: "again" } }
        }
        return { data: [user("m2", 2), user("m3", 3)], cursor: { next: null } }
      },
    },
  } as unknown as Context["client"]

  const messages = await fetchAllMessages(client, "ses_test")
  assert.deepEqual(
    messages.map((message) => message.id),
    ["m1", "m2", "m3"],
  )
})
