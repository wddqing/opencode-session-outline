# OpenCode Session Outline

在 OpenCode TUI 右侧边栏显示当前会话的结构大纲：轮次、工具操作、错误和上下文压缩。长会话里可以按轮次快速定位，也可以打开某个工具调用的详情。

> 适用于 OpenCode V2（本插件在 `2.1.4` 上开发并验证）。

## 功能

- 侧边栏大纲，按 **user 轮次**分组，显示 `轮次数 / 工具数 / 错误数`
- 每轮可展开，列出工具操作、shell 命令、错误、压缩、技能和中断标记
- 点击轮次标题：滚动原生会话到该轮用户消息
- 点击操作：打开详情面板，查看工具输入、输出、错误、shell 输出等
- 详情面板提供 `↑ Jump to turn`，关闭面板并回到操作所属轮次
- 长会话分页：默认显示最近 50 轮，可点 `… N earlier turns` 继续加载
- 单轮操作过多时保留前 30 条，并提示 `… N more actions`
- 实时更新：流式工具状态、新轮次、错误会自动刷新

## 安装

插件直接放在 OpenCode 的 CLI 插件发现目录：

```text
~/.config/opencode/plugins/opencode-session-outline
```

当前已按这种方式安装，不需要软链接，也不需要改 `cli.json`。

全新机器：

```bash
git clone git@github.com:wddqing/opencode-session-outline.git \
  ~/.config/opencode/plugins/opencode-session-outline
cd ~/.config/opencode/plugins/opencode-session-outline
npm install
```

保存后 OpenCode 会自动重载；如果当前 TUI 没反应，执行 `/reload` 或重新打开。

### 可选：写入 `cli.json`

如果不想放在发现目录，也可以在 `~/.config/opencode/cli.json` 的 `plugins` 里写绝对路径：

```json
{
  "plugins": ["/Users/wddqing/.config/opencode/plugins/opencode-session-outline"]
}
```

两种方式二选一，不要同时使用。

### 可选参数

```json
{
  "plugins": [
    {
      "package": "/Users/wddqing/.config/opencode/plugins/opencode-session-outline",
      "options": { "jumpStepMs": 70 }
    }
  ]
}
```

`jumpStepMs` 控制逐条跳转时每次内置命令之间的等待时间，默认 70ms。终端较慢时可以调大。

## 使用

1. 打开一个会话，右侧边栏会自动显示 **Session Outline**，位置在 Context、MCP、Todo 之后（`session.sidebar` 为 `auto` 时，终端过窄不会显示）。
2. 点击轮次标题跳转；点击左侧 `▸ / ▾` 展开或折叠该轮。
3. 点击展开后的操作行，打开详情面板。
4. 详情面板底部：`↑ Jump to turn` 回到所属轮次，`Close` 关闭。
5. 点击 `Session Outline` 标题可以整体折叠大纲。

## 支持的范围

当前版本（MVP）覆盖：

| 级别 | 内容 | 状态 |
|---|---|---|
| L1 轮次 | 每条非空 user 消息 | ✅ |
| L3 操作 | assistant 里的工具调用、shell 消息 | ✅ |
| 事件 | 工具错误、assistant 错误/重试、压缩、技能、中断、轮次失败 | ✅ |
| L2 步骤 | assistant 消息作为独立层级 | 未单独展示（操作直接挂在轮次下） |
| L0 子会话 | 子代理会话 | 未实现 |

## 跳转原理与限制

OpenCode V2 的插件 API **没有公开的“滚动到某条消息”接口**。本插件用的是宿主内置命令：

- 目标不是最后一轮：`session.first` 加载全部消息并回到顶部，再按目标序号重复调用 `session.message.user.next`
- 目标是最后一轮：直接调用 `session.messages_last_user`

因此：

- **轮次跳转是近似实现**，依赖内置命令的时序；每次命令之间需要等待约 70ms
- `session.first` 会加载整段历史；超过 10 秒未加载完会放弃跳转并提示
- 工具操作不能直接滚动到工具行；点击工具会打开详情面板，面板里可以再跳回所属轮次
- 会话存在 revert（回退）边界时，历史轮次序号可能和宿主当前导航列表不完全一致
- OpenCode 版本升级可能改变内置命令行为，需要重新验证

## 开发

```bash
npm install
npm run typecheck
npm test
```

目录：

```text
src/outline.ts   消息 → 大纲模型（纯函数，可单测）
src/jump.ts      内置命令跳转控制器
src/detail.ts    详情面板文本构建
src/tui.tsx      侧边栏 slot + 详情 panel
src/index.ts     server 入口（空实现，保持包结构）
tui.tsx          本地发现/加载入口
test/            单元测试
```

## 已验证

- 独立 TUI 实例加载插件并渲染侧边栏
- 4 轮测试会话：点击第 1/2/3/最后一轮，原生会话均落到对应 user 消息
- 工具操作 → 详情面板：显示工具名、状态、输入/输出，底部有跳转和关闭
- 从详情面板点击 `↑ Jump to turn`：面板关闭并正确落到所属轮次
- `npm run typecheck` 通过；14 个单元测试通过
- 真实配置（`~/.config/opencode/plugins` 发现目录）加载通过

## 已知限制

- 单轮最多显示 30 条操作；更多操作请用原生 `/timeline` 或直接看会话
- 默认不显示 assistant 步骤层级、子会话和搜索/过滤
- 极长会话首次加载会请求多页消息，可能有短暂延迟
- 侧边栏宽度固定约 42 列，标题和操作文本会截断
