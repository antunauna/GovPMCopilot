# GovPM Copilot

政府项目全流程自动化助手 — 轻量级 CLI 工具，基于 Agent Loop 架构。

## 特性

- 🔄 **Agent Loop** — 流式输出 + 多轮工具调用 + 上下文自动压缩
- 🤖 **双 Provider** — 支持 Anthropic Claude 和阿里百炼（DashScope）
- 🔧 **工具系统** — 文件读写、工具自省，可扩展
- 🌐 **联网搜索** — 通过 DashScope 原生 `enable_search` 实时检索政府政策
- 💬 **交互模式** — REPL 交互 + `--chat` 单次对话

## 快速开始

```bash
# 安装依赖
npm install

# 配置 API Key（二选一）
set DASHSCOPE_API_KEY=sk-your-key    # 阿里百炼（推荐国内用户）
set ANTHROPIC_API_KEY=sk-your-key    # Anthropic Claude

# 交互模式
npm run dev

# 单次对话
npx tsx src/index.ts --chat "2026年深圳高新技术企业补贴政策"
```

## 架构

```
src/
├── index.ts              # CLI 入口（REPL + --chat 单次模式）
├── config.ts             # 配置管理（环境变量 > 配置文件 > 默认值）
├── types.ts              # 统一类型定义
├── agent/
│   ├── loop.ts           # Agent Loop 核心（流式循环 + 工具执行 + 上下文压缩）
│   └── compact.ts        # Token 估算
├── providers/
│   ├── dashscope.ts      # 阿里百炼 Provider（OpenAI 兼容协议）
│   └── anthropic.ts      # Anthropic Provider
└── tools/
    └── index.ts          # 工具注册（read_file, write_file, list_tools）
```

## 工具

| 工具 | 说明 | 权限 |
|------|------|------|
| `read_file` | 读取文件内容 | auto |
| `write_file` | 写入文件（需确认） | confirm |
| `list_tools` | 列出可用工具 | auto |

联网搜索通过 DashScope API 原生 `enable_search` 参数实现，无需独立工具。

## REPL 命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助 |
| `/tools` | 列出工具 |
| `/status` | 上下文状态 |
| `/config` | 显示配置 |
| `/clear` | 清空对话历史 |
| `/compact` | 手动压缩上下文 |
| `/quit` | 退出 |

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DASHSCOPE_API_KEY` | 阿里百炼 API Key | - |
| `ANTHROPIC_API_KEY` | Anthropic API Key | - |
| `GOVPM_PROVIDER` | LLM 提供商 | `dashscope` |
| `GOVPM_MODEL` | 模型名称 | `qwen-plus` |
| `GOVPM_DATA_DIR` | 数据目录 | `./govpm-data` |
| `LLM_BASE_URL` | 自定义 API 地址 | - |

## License

MIT
