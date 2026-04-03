# GovPM Copilot v0.4

政府项目全流程自动化助手 — 一个轻量的 CLI Agent 工具，借鉴 Claude Code 架构设计。

## 特性

- **双 Provider** — 阿里百炼（DashScope）+ Anthropic Claude，REPL 内可动态切换
- **流式 Agent Loop** — 多轮工具调用，上下文自动压缩
- **联网搜索** — DashScope 原生 `enable_search`，无需独立搜索工具
- **LLM 调用重试** — 指数退避重试（2s→4s→8s，最多 3 次），自动跳过不可重试错误
- **会话自动清理** — 30 天过期 + 最多 50 条，启动时自动清理
- **Token 成本持久化** — 每次请求自动记录到 `~/.govpm/cost-tracker.json`，跨会话累计
- **成本监控 Dashboard** — `/dashboard` 启动 Web 面板，可视化 token/cost 趋势
- **Markdown 渲染** — 终端内渲染标题、列表、表格（自动列宽）、代码块（语法标签）、任务列表、删除线
- **中断处理** — Ctrl+C / Escape 中断当前请求，保留上下文（双击 Ctrl+C 退出）
- **API 重试** — 429/5xx 自动指数退避重试（1s→2s→4s，最大 30s）
- **工具超时** — 每个工具执行有独立超时控制（默认 30s）
- **对话持久化** — 自动保存到 `~/.govpm/sessions/`，支持恢复
- **System Prompt 动态化** — 支持从文件加载或命令行设置
- **工具可视化** — Spinner 动画 + 参数摘要 + 结果预览
- **零运行时依赖** — 仅依赖 `@anthropic-ai/sdk`（可选），渲染/压缩/重试全部自研

## 快速开始

```bash
# 安装依赖
npm install

# 设置 API Key
set DASHSCOPE_API_KEY=sk-xxx

# 启动
npm run dev
```

## 架构

```
src/
├── index.ts          # CLI 入口（REPL + 单次模式 + Ctrl+C 处理）
├── config.ts         # 配置管理（环境变量 > 配置文件 > 默认值）
├── types.ts          # 统一类型定义
├── agent/
│   ├── loop.ts       # 核心引擎（流式循环 + LLM重试 + 工具执行 + 成本持久化）
│   └── compact.ts    # 上下文压缩（本地提取 + LLM 摘要 + 熔断）
├── providers/
│   ├── dashscope.ts  # 百炼 Provider（OpenAI 兼容 + 重试 + 中断）
│   └── anthropic.ts  # Anthropic Provider
├── tools/
│   └── index.ts      # 工具集（read_file / write_file / list_tools）
└── utils/
    ├── render.ts     # Markdown 终端渲染（表格/任务列表/终端宽度自适应，零依赖）
    ├── spinner.ts    # Spinner 动画 + 超时包装
    ├── retry.ts      # HTTP 重试（指数退避）
    ├── session.ts    # 对话持久化 + 会话清理 + 成本追踪持久化
    ├── dashboard.ts  # 成本监控 Web Dashboard（原生 http 模块）
    └── index.ts      # 工具导出
```

## REPL 命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助 |
| `/status` | 当前状态（消息数、token） |
| `/cost` | Token/成本统计（本次 + 累计 + 7天趋势） |
| `/dashboard` | 打开成本监控 Web 面板 |
| `/tools` | 列出工具 |
| `/clear` | 清空对话历史 |
| `/compact` | 手动压缩上下文 |
| `/save` | 保存当前会话 |
| `/resume` | 恢复上次会话 |
| `/sessions` | 列出历史会话 |
| `/provider` | 切换 Provider |
| `/model` | 切换模型 |
| `/system` | 设置 System Prompt |
| `/quit` | 退出（自动保存） |

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DASHSCOPE_API_KEY` | 阿里百炼 API Key | — |
| `ANTHROPIC_API_KEY` | Anthropic API Key | — |
| `GOVPM_PROVIDER` | LLM 提供商 | `dashscope` |
| `GOVPM_MODEL` | 模型名称 | `qwen-plus` |
| `LLM_BASE_URL` | 自定义 API 地址 | 百炼官方 |

## 快捷键

| 键 | 说明 |
|----|------|
| `Ctrl+C` | 中断当前请求（保留上下文） |
| `Ctrl+C` × 2 | 退出程序 |
| `Escape` | 中断当前请求 |

## 数据存储

| 路径 | 说明 |
|------|------|
| `~/.govpm/sessions/` | 会话历史（JSON） |
| `~/.govpm/cost-tracker.json` | 成本追踪数据 |
| `~/.govpm/config.json` | 用户配置 |

## 技术栈

- TypeScript + ES2022 + ES Modules
- Node.js 18+
- 零 UI 框架（纯 CLI + ANSI 转义码）
- 参考 Claude Code 的 Agent Loop / Permission Pipeline / Skill System 设计

## License

MIT
