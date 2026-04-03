/**
 * GovPMCopilot v0.3 - 统一类型定义
 */

// ============================================
// 消息类型（兼容 Anthropic API 格式）
// ============================================

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;           // tool_use_id / tool_call_id
  name?: string;        // tool name
  input?: unknown;      // tool input
  output?: string;      // tool result
}

export interface SystemMessage {
  role: 'system';
  content: string;
}

// ============================================
// LLM Provider
// ============================================

export type ProviderType = 'anthropic' | 'dashscope';

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  tools?: ToolDef[];
  toolChoice?: 'auto' | 'none' | { type: 'tool'; name: string };
  enableSearch?: boolean;  // 启用联网搜索（百炼专用）
  signal?: AbortSignal;    // 用于中断请求
}

export interface ChatResponse {
  content: ContentBlock[];
  stopReason: 'end_turn' | 'max_tokens' | 'tool_use';
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export interface StreamEvent {
  type: 'text' | 'tool_use_start' | 'tool_use_delta' | 'tool_use_end' | 'message_end' | 'error';
  text?: string;
  toolId?: string;
  toolName?: string;
  inputJson?: string;  // JSON delta for tool input
  stopReason?: string;
  usage?: { inputTokens: number; outputTokens: number };
  error?: string;
}

export interface LLMProvider {
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
  chatStream(messages: Message[], options?: ChatOptions): AsyncIterable<StreamEvent>;
  readonly name: string;
  readonly model: string;
}

// ============================================
// Token 追踪
// ============================================

export interface TokenUsage {
  totalInput: number;
  totalOutput: number;
  requestCount: number;
}

// ============================================
// Tool 系统
// ============================================

export interface ToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface Tool {
  /** 工具定义（发给 LLM） */
  def: ToolDef;
  /** 执行工具调用 */
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string>;
  /** 权限级别 */
  permission?: 'auto' | 'confirm' | 'block';
  /** 超时时间（ms），默认 30000 */
  timeout?: number;
}

export interface ToolContext {
  dataDir: string;
  workDir: string;
}

// ============================================
// 配置
// ============================================

export interface AppConfig {
  provider: ProviderType;
  model: string;
  apiKey: string;
  baseUrl?: string;
  dataDir: string;
  maxTokens: number;
  temperature: number;
  verbose: boolean;
}

// ============================================
// Agent 配置
// ============================================

export interface AgentConfig {
  maxTurns: number;
  maxContextTokens: number;
  compactThreshold: number;
  stream: boolean;
  /** System Prompt 文件路径（优先级高于内置默认） */
  systemPromptFile?: string;
}
