/**
 * 对话持久化
 * 自动保存/恢复会话历史
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { Message } from '../types.js';

const SESSIONS_DIR = join(homedir(), '.govpm', 'sessions');

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
    require('fs').unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}
