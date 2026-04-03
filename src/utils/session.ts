/**
 * 对话持久化 v0.4
 * 自动保存/恢复会话历史 + 会话清理 + Token 追踪持久化
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { Message } from '../types.js';

const SESSIONS_DIR = join(homedir(), '.govpm', 'sessions');
const COST_TRACKER_FILE = join(homedir(), '.govpm', 'cost-tracker.json');
const MAX_SESSIONS = 50;           // 最多保留会话数
const MAX_SESSION_AGE_DAYS = 30;   // 会话最长保留天数

/** 确保目录存在 */
function ensureDir(): void {
  mkdirSync(SESSIONS_DIR, { recursive: true });
}

/** 生成会话 ID（时间戳） */
function sessionId(): string {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/** 会话元数据 */
export interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/** 获取第一条用户消息作为标题（截断到 40 字符） */
function extractTitle(messages: Message[]): string {
  for (const m of messages) {
    if (m.role === 'user') {
      const text = typeof m.content === 'string' ? m.content : '';
      return text.slice(0, 40) + (text.length > 40 ? '...' : '') || '(空对话)';
    }
  }
  return '(空对话)';
}

/** 保存会话 */
export function saveSession(messages: Message[]): string {
  ensureDir();
  const id = sessionId();
  const filePath = join(SESSIONS_DIR, `${id}.json`);
  const meta: SessionMeta = {
    id,
    title: extractTitle(messages),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: messages.length,
  };

  writeFileSync(filePath, JSON.stringify({ meta, messages }, null, 2), 'utf-8');
  return id;
}

/** 更新已有会话 */
export function updateSession(sessionId: string, messages: Message[]): void {
  const filePath = join(SESSIONS_DIR, `${sessionId}.json`);
  if (!existsSync(filePath)) {
    saveSession(messages);
    return;
  }

  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
    data.meta.updatedAt = new Date().toISOString();
    data.meta.messageCount = messages.length;
    data.meta.title = extractTitle(messages);
    data.messages = messages;
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch {
    // 如果文件损坏，重新保存
    saveSession(messages);
  }
}

/** 加载会话 */
export function loadSession(sessionId: string): { meta: SessionMeta; messages: Message[] } | null {
  const filePath = join(SESSIONS_DIR, `${sessionId}.json`);
  if (!existsSync(filePath)) return null;

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/** 列出所有会话（按时间倒序） */
export function listSessions(): SessionMeta[] {
  ensureDir();
  const files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
  const sessions: SessionMeta[] = [];

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(SESSIONS_DIR, file), 'utf-8'));
      sessions.push(data.meta);
    } catch { /* skip */ }
  }

  sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return sessions;
}

/** 获取最近的会话 */
export function getLatestSession(): { meta: SessionMeta; messages: Message[] } | null {
  const sessions = listSessions();
  if (sessions.length === 0) return null;
  return loadSession(sessions[0].id);
}

/** 删除会话 */
export function deleteSession(sessionId: string): boolean {
  const filePath = join(SESSIONS_DIR, `${sessionId}.json`);
  if (!existsSync(filePath)) return false;
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

// ============================================
// 会话自动清理
// ============================================

/**
 * 清理过期/过多的会话文件
 * - 超过 MAX_SESSION_AGE_DAYS 天的会话自动删除
 * - 超过 MAX_SESSIONS 数量时，删除最旧的
 * @returns 删除的文件数
 */
export function cleanupSessions(): number {
  ensureDir();
  const sessions = listSessions();
  let deletedCount = 0;
  const now = Date.now();
  const maxAge = MAX_SESSION_AGE_DAYS * 24 * 60 * 60 * 1000;

  // 1. 删除过期会话
  for (const s of sessions) {
    const age = now - new Date(s.updatedAt).getTime();
    if (age > maxAge) {
      deleteSession(s.id);
      deletedCount++;
    }
  }

  // 2. 如果仍然超限，删除最旧的
  const remaining = listSessions();
  if (remaining.length > MAX_SESSIONS) {
    const toDelete = remaining.slice(MAX_SESSIONS);
    for (const s of toDelete) {
      deleteSession(s.id);
      deletedCount++;
    }
  }

  return deletedCount;
}

// ============================================
// Token / 成本追踪持久化
// ============================================

export interface CostRecord {
  date: string;           // YYYY-MM-DD
  totalInput: number;
  totalOutput: number;
  requestCount: number;
  provider: string;       // dashscope | anthropic
  model: string;
  estimatedCost: number;  // 估算费用（元）
}

export interface CostTracker {
  daily: CostRecord[];
  allTime: {
    totalInput: number;
    totalOutput: number;
    requestCount: number;
    estimatedCost: number;
  };
}

/** 估算费用（元） */
function estimateCost(inputTokens: number, outputTokens: number, provider: string): number {
  // 百炼 qwen-plus: 4元/百万输入 + 12元/百万输出
  // Anthropic Claude Sonnet: ~3美元/百万输入 + ~15美元/百万输出
  if (provider === 'anthropic') {
    return inputTokens * 0.0000216 + outputTokens * 0.000108;  // 美元转人民币约7.2
  }
  // dashscope 默认
  return inputTokens * 0.000004 + outputTokens * 0.000012;
}

/** 加载成本追踪数据 */
export function loadCostTracker(): CostTracker {
  if (!existsSync(COST_TRACKER_FILE)) {
    return { daily: [], allTime: { totalInput: 0, totalOutput: 0, requestCount: 0, estimatedCost: 0 } };
  }
  try {
    return JSON.parse(readFileSync(COST_TRACKER_FILE, 'utf-8'));
  } catch {
    return { daily: [], allTime: { totalInput: 0, totalOutput: 0, requestCount: 0, estimatedCost: 0 } };
  }
}

/** 保存成本追踪数据 */
export function saveCostTracker(tracker: CostTracker): void {
  mkdirSync(join(homedir(), '.govpm'), { recursive: true });
  writeFileSync(COST_TRACKER_FILE, JSON.stringify(tracker, null, 2), 'utf-8');
}

/**
 * 记录一次 LLM 请求的 token 使用
 * 自动累加到当日记录
 */
export function recordUsage(
  inputTokens: number,
  outputTokens: number,
  provider: string,
  model: string,
): void {
  const tracker = loadCostTracker();
  const today = new Date().toISOString().slice(0, 10);
  const cost = estimateCost(inputTokens, outputTokens, provider);

  // 更新当日记录
  let daily = tracker.daily.find(d => d.date === today);
  if (!daily) {
    daily = { date: today, totalInput: 0, totalOutput: 0, requestCount: 0, provider, model, estimatedCost: 0 };
    tracker.daily.push(daily);
  }
  daily.totalInput += inputTokens;
  daily.totalOutput += outputTokens;
  daily.requestCount++;
  daily.estimatedCost += cost;
  daily.provider = provider;
  daily.model = model;

  // 更新累计
  tracker.allTime.totalInput += inputTokens;
  tracker.allTime.totalOutput += outputTokens;
  tracker.allTime.requestCount++;
  tracker.allTime.estimatedCost += cost;

  // 只保留最近 90 天
  tracker.daily = tracker.daily.slice(-90);

  saveCostTracker(tracker);
}
