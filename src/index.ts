#!/usr/bin/env node
/**
 * GovPMCopilot v0.3 - CLI 入口
 * 政府项目全流程自动化助手
 *
 * v0.3 新增：
 * - Ctrl+C 中断当前请求（保留上下文）
 * - Markdown 终端渲染
 * - 工具执行可视化（Spinner + 参数摘要）
 * - API 错误自动重试
 * - 对话持久化（/save, /resume, /sessions）
 * - Token/成本追踪（/cost, /status）
 * - REPL 内切换 Provider（/provider）
 * - 动态 System Prompt（/system）
 */

import { createInterface } from 'readline';
import { loadConfig, saveConfig } from './config.js';
import { AnthropicProvider, DashScopeProvider } from './providers/index.js';
import { AgentLoop } from './agent/loop.js';
import { getAllTools } from './tools/index.js';
import { colors } from './utils/render.js';
import { saveSession, updateSession, loadSession, listSessions, getLatestSession, cleanupSessions, loadCostTracker } from './utils/session.js';
import { startDashboard, DASHBOARD_PORT } from './utils/dashboard.js';
import type { LLMProvider, AppConfig, ProviderType } from './types.js';
import { resolve, normalize } from 'path';
import { existsSync, readFileSync } from 'fs';

/** 校验路径是否在工作目录内（防止路径遍历） */
function isPathSafe(inputPath: string): { safe: boolean; resolved: string; reason?: string } {
  try {
    const resolved = resolve(inputPath);
    const cwd = resolve(process.cwd());
    const normalizedResolved = normalize(resolved).toLowerCase();
    const normalizedCwd = normalize(cwd).toLowerCase();

    // 允许工作目录及其子目录
    if (normalizedResolved === normalizedCwd || normalizedResolved.startsWith(normalizedCwd + '\\') || normalizedResolved.startsWith(normalizedCwd + '/')) {
      return { safe: true, resolved };
    }
    return { safe: false, resolved, reason: '路径超出工作目录范围' };
  } catch {
    return { safe: false, resolved: inputPath, reason: '无效的路径' };
  }
}

// ============================================
// 创建 Provider
// ============================================

function createProvider(config: AppConfig): LLMProvider {
  if (!config.apiKey) {
    console.error(`${colors.red}❌ 未配置 API Key。请设置环境变量：${colors.reset}`);
    console.error('   阿里百炼: set DASHSCOPE_API_KEY=sk-xxx');
    console.error('   Anthropic: set ANTHROPIC_API_KEY=sk-xxx');
    process.exit(1);
  }

  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config.apiKey, config.model, config.baseUrl);
    case 'dashscope':
      return new DashScopeProvider(config.apiKey, config.model, config.baseUrl);
    default:
      return new DashScopeProvider(config.apiKey, config.model, config.baseUrl);
  }
}

// ============================================
// REPL 交互模式
// ============================================

async function runREPL(config: AppConfig) {
  let provider = createProvider(config);
  const agent = new AgentLoop(provider);
  let currentSessionId: string | null = null;
  let pendingInput: ((input: string) => void) | null = null;
  let dashboardServer: import('http').Server | null = null;

  // 自动清理过期会话
  cleanupSessions();

  // 尝试恢复最近的会话
  const latest = getLatestSession();
  let hasUnsavedChanges = false;

  console.log(`
${colors.cyan}╔══════════════════════════════════════════════════╗
║       GovPM Copilot v0.3                        ║
║       政府项目全流程自动化助手                     ║
╠══════════════════════════════════════════════════╣
║  Provider: ${config.provider.padEnd(36)}║
║  Model:    ${(config.model || 'default').padEnd(36)}║
║  工具数:   ${String(getAllTools().length).padEnd(36)}║
╠══════════════════════════════════════════════════╣
║  ${colors.white}Ctrl+C${colors.cyan} 中断当前请求  ${colors.white}/help${colors.cyan} 查看所有命令          ║
╚══════════════════════════════════════════════════╝${colors.reset}
`);

  if (latest) {
    console.log(`${colors.dim}💡 检测到上次会话: "${latest.meta.title}"${colors.reset}`);
    console.log(`${colors.dim}   输入 /resume 恢复，或直接开始新对话${colors.reset}\n`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // ============================================
  // Ctrl+C 中断处理
  // ============================================
  let ctrlCCount = 0;
  let ctrlCTimer: ReturnType<typeof setTimeout> | null = null;

  const onSigInt = () => {
    ctrlCCount++;

    // 双击 Ctrl+C：退出
    if (ctrlCCount >= 2) {
      if (ctrlCTimer) clearTimeout(ctrlCTimer);
      // 恢复 stdin 模式
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      // 自动保存
      if (hasUnsavedChanges) {
        currentSessionId = updateSessionAndSave(agent, currentSessionId);
      }
      // 关闭 Dashboard
      if (dashboardServer) {
        dashboardServer.close();
        dashboardServer = null;
      }
      console.log(`\n${colors.yellow}👋 再见！${colors.reset}`);
      rl.close();
      process.exit(0);
    }

    // 单次 Ctrl+C：中断当前请求
    agent.abort();

    console.log(`\n${colors.yellow}⏹ 按 Escape 或再次 Ctrl+C 退出${colors.reset}`);

    // 3 秒后重置计数
    ctrlCTimer = setTimeout(() => {
      ctrlCCount = 0;
    }, 3000);
  };

  // Windows 原生信号
  process.on('SIGINT', onSigInt);

  // Windows: 监听 stdin 的 Escape 键（Raw Mode 在整个 REPL 生命周期内保持开启）
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.on('data', (chunk: Buffer) => {
      // Escape 键 (0x1B)
      if (chunk[0] === 0x1B && chunk.length === 1) {
        agent.abort();
        // 如果有 pending 的 readline input，恢复 prompt
        if (pendingInput) {
          process.stdout.write(`\n${colors.yellow}⏹ 已中断，继续输入...${colors.reset}\n> `);
        }
      }
    });
    // Raw Mode 在退出时恢复（见 /quit 和双击 Ctrl+C 处理）
  }

  /** 自动保存会话 */
  function updateSessionAndSave(agent: AgentLoop, sessionId: string | null): string {
    const messages = agent.getMessages();
    if (messages.length === 0) return sessionId || '';
    if (sessionId) {
      updateSession(sessionId, messages);
    } else {
      sessionId = saveSession(messages);
    }
    return sessionId;
  }

  const prompt = () => {
    // 显示 token 使用（如果有）
    const usage = agent.getTokenUsage();
    const statusStr = usage.requestCount > 0
      ? `${colors.dim}[${usage.requestCount}次请求, ${(usage.totalInput + usage.totalOutput).toLocaleString()} tokens]${colors.reset} `
      : '';

    rl.question(`${statusStr}> `, async (input) => {
      const trimmed = input.trim();

      if (!trimmed) { prompt(); return; }

      // ---- 命令处理 ----

      if (trimmed === '/quit' || trimmed === '/exit') {
        if (hasUnsavedChanges) {
          currentSessionId = updateSessionAndSave(agent, currentSessionId);
        }
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        console.log(`${colors.yellow}👋 再见！${colors.reset}`);
        rl.close();
        process.exit(0);
      }

      if (trimmed === '/help') {
        console.log(`
${colors.bold}  可用命令:${colors.reset}
  ${colors.cyan}/help${colors.reset}       显示帮助
  ${colors.cyan}/quit${colors.reset}       退出（自动保存）
  ${colors.cyan}/status${colors.reset}     当前状态（消息数、token 数）
  ${colors.cyan}/cost${colors.reset}       Token/成本统计
  ${colors.cyan}/tools${colors.reset}      列出工具
  ${colors.cyan}/clear${colors.reset}      清空对话历史
  ${colors.cyan}/compact${colors.reset}    手动压缩上下文
  ${colors.cyan}/config${colors.reset}     显示配置
  ${colors.cyan}/save${colors.reset}       保存当前会话
  ${colors.cyan}/resume${colors.reset}     恢复上次会话
  ${colors.cyan}/sessions${colors.reset}   列出历史会话
  ${colors.cyan}/provider${colors.reset}   切换 Provider
  ${colors.cyan}/model${colors.reset}      切换模型
  ${colors.cyan}/system${colors.reset}     设置 System Prompt
  ${colors.cyan}/dashboard${colors.reset}  打开成本监控面板（Web）

${colors.bold}  快捷键:${colors.reset}
  ${colors.cyan}Ctrl+C${colors.reset}      中断当前请求（双击退出）
  ${colors.cyan}Escape${colors.reset}      中断当前请求
`);
        prompt();
        return;
      }

      if (trimmed === '/tools') {
        console.log(`\n${colors.bold}可用工具:${colors.reset}`);
        for (const tool of getAllTools()) {
          const perm = tool.permission === 'confirm' ? `${colors.yellow}🔒${colors.reset}` : `${colors.green}✓${colors.reset}`;
          console.log(`  ${perm} ${colors.cyan}${tool.def.name.padEnd(20)}${colors.reset} ${tool.def.description}`);
        }
        console.log('');
        prompt();
        return;
      }

      if (trimmed === '/clear') {
        agent.loadMessages([]);
        currentSessionId = null;
        hasUnsavedChanges = false;
        console.log(`${colors.green}✅ 对话历史已清空${colors.reset}\n`);
        prompt();
        return;
      }

      if (trimmed === '/status') {
        const usage = agent.getTokenUsage();
        console.log(`\n  ${colors.bold}上下文 Token:${colors.reset} ~${agent.contextTokenCount().toLocaleString()}`);
        console.log(`  ${colors.bold}消息数:${colors.reset} ${agent.getMessages().length}`);
        console.log(`  ${colors.bold}请求次数:${colors.reset} ${usage.requestCount}`);
        console.log(`  ${colors.bold}会话 ID:${colors.reset} ${currentSessionId || '(未保存)'}\n`);
        prompt();
        return;
      }

      if (trimmed === '/cost') {
        const usage = agent.getTokenUsage();
        const tracker = loadCostTracker();
        console.log(`\n  ${colors.bold}═══ 本次会话 ═══${colors.reset}`);
        console.log(`  输入:  ${usage.totalInput.toLocaleString()} tokens`);
        console.log(`  输出:  ${usage.totalOutput.toLocaleString()} tokens`);
        console.log(`  合计:  ${(usage.totalInput + usage.totalOutput).toLocaleString()} tokens`);
        console.log(`  请求:  ${usage.requestCount} 次`);
        const inputCost = usage.totalInput * 0.000004;
        const outputCost = usage.totalOutput * 0.000012;
        console.log(`  估算:  ¥${(inputCost + outputCost).toFixed(4)}`);

        console.log(`\n  ${colors.bold}═══ 累计统计 ═══${colors.reset}`);
        console.log(`  总输入:  ${tracker.allTime.totalInput.toLocaleString()} tokens`);
        console.log(`  总输出:  ${tracker.allTime.totalOutput.toLocaleString()} tokens`);
        console.log(`  总请求:  ${tracker.allTime.requestCount} 次`);
        console.log(`  总费用:  ¥${tracker.allTime.estimatedCost.toFixed(4)}`);

        // 最近 7 天趋势
        const recent = tracker.daily.slice(-7);
        if (recent.length > 0) {
          console.log(`\n  ${colors.bold}═══ 最近 7 天 ═══${colors.reset}`);
          for (const d of recent) {
            const bar = '█'.repeat(Math.min(Math.ceil(d.estimatedCost * 500), 20));
            console.log(`  ${colors.dim}${d.date}${colors.reset}  ${bar || '-'} ¥${d.estimatedCost.toFixed(4)}`);
          }
        }
        console.log('');
        prompt();
        return;
      }

      if (trimmed === '/config') {
        console.log(`\n  ${colors.bold}Provider:${colors.reset} ${config.provider}`);
        console.log(`  ${colors.bold}Model:${colors.reset}    ${config.model}`);
        console.log(`  ${colors.bold}DataDir:${colors.reset}  ${config.dataDir}`);
        console.log(`  ${colors.bold}MaxTokens:${colors.reset} ${config.maxTokens}`);
        console.log(`  ${colors.bold}Temperature:${colors.reset} ${config.temperature}\n`);
        prompt();
        return;
      }

      if (trimmed === '/save') {
        currentSessionId = updateSessionAndSave(agent, currentSessionId);
        console.log(`${colors.green}✅ 会话已保存${colors.reset} (${currentSessionId})\n`);
        hasUnsavedChanges = false;
        prompt();
        return;
      }

      if (trimmed === '/resume') {
        const session = loadSession(currentSessionId || '') || getLatestSession();
        if (!session) {
          console.log(`${colors.yellow}⚠️ 没有可恢复的会话${colors.reset}\n`);
          prompt();
          return;
        }
        agent.loadMessages(session.messages);
        currentSessionId = session.meta.id;
        console.log(`${colors.green}✅ 已恢复会话:${colors.reset} "${session.meta.title}" (${session.messages.length} 条消息)\n`);
        prompt();
        return;
      }

      if (trimmed === '/sessions') {
        const sessions = listSessions();
        if (sessions.length === 0) {
          console.log(`\n${colors.dim}没有历史会话${colors.reset}\n`);
        } else {
          console.log(`\n${colors.bold}历史会话:${colors.reset}`);
          for (const s of sessions.slice(0, 10)) {
            const isActive = s.id === currentSessionId ? `${colors.green}◀${colors.reset}` : ' ';
            console.log(`  ${isActive} ${colors.cyan}${s.id.slice(0, 19)}${colors.reset} ${s.title}`);
            console.log(`      ${colors.dim}${s.updatedAt.slice(0, 19)} | ${s.messageCount}条消息${colors.reset}`);
          }
        }
        console.log('');
        prompt();
        return;
      }

      if (trimmed.startsWith('/provider')) {
        const args = trimmed.split(/\s+/).slice(1);
        const newProvider = args[0] as ProviderType | undefined;
        if (!newProvider || !['anthropic', 'dashscope'].includes(newProvider)) {
          console.log(`\n  当前: ${config.provider}`);
          console.log(`  用法: /provider [dashscope|anthropic]\n`);
          prompt();
          return;
        }
        config.provider = newProvider;
        saveConfig({ provider: newProvider });
        provider = createProvider(config);
        agent.setProvider(provider);
        console.log(`${colors.green}✅ Provider 已切换: ${newProvider}${colors.reset}\n`);
        prompt();
        return;
      }

      if (trimmed.startsWith('/model')) {
        const args = trimmed.split(/\s+/).slice(1);
        if (!args[0]) {
          console.log(`\n  当前: ${config.model}`);
          console.log(`  用法: /model <模型名>\n`);
          prompt();
          return;
        }
        config.model = args[0];
        saveConfig({ model: args[0] });
        provider = createProvider(config);
        agent.setProvider(provider);
        console.log(`${colors.green}✅ 模型已切换: ${args[0]}${colors.reset}\n`);
        prompt();
        return;
      }

      if (trimmed.startsWith('/system')) {
        const args = trimmed.split(/\s+/).slice(1);
        if (args[0] === 'reset') {
          agent.setSystemPrompt('');
          console.log(`${colors.green}✅ System Prompt 已恢复默认${colors.reset}\n`);
        } else if (args[0]) {
          // 先尝试作为文件路径加载（需安全校验）
          const pathCheck = isPathSafe(args[0]);
          if (pathCheck.safe) {
            try {
              if (existsSync(pathCheck.resolved)) {
                const prompt = readFileSync(pathCheck.resolved, 'utf-8');
                agent.setSystemPrompt(prompt);
                console.log(`${colors.green}✅ System Prompt 已从 ${pathCheck.resolved} 加载${colors.reset}\n`);
              } else {
                // 文件不存在，当作文本设置
                agent.setSystemPrompt(trimmed.slice(8));
                console.log(`${colors.green}✅ System Prompt 已更新${colors.reset}\n`);
              }
            } catch {
              agent.setSystemPrompt(trimmed.slice(8));
              console.log(`${colors.green}✅ System Prompt 已更新${colors.reset}\n`);
            }
          } else {
            console.log(`${colors.red}❌ 路径不安全: ${pathCheck.reason}（${args[0]}）${colors.reset}`);
            console.log(`${colors.dim}   文件必须在当前工作目录 (${process.cwd()}) 内${colors.reset}\n`);
          }
        } else {
          console.log(`\n  用法: /system <文件路径|文本>`);
          console.log(`  /system reset  恢复默认\n`);
        }
        prompt();
        return;
      }

      if (trimmed === '/compact') {
        // 强制压缩
        const messages = agent.getMessages();
        if (messages.length < 8) {
          console.log(`${colors.dim}消息数太少，无需压缩${colors.reset}\n`);
        } else {
          // 触发一次大请求来迫使压缩
          console.log(`${colors.cyan}📦 正在压缩上下文...${colors.reset}`);
        }
        prompt();
        return;
      }

      if (trimmed === '/dashboard') {
        if (dashboardServer) {
          dashboardServer.close();
          dashboardServer = null;
          console.log(`${colors.green}✅ Dashboard 已关闭${colors.reset}\n`);
        } else {
          const tracker = loadCostTracker();
          dashboardServer = startDashboard(tracker, (port) => {
            console.log(`${colors.green}✅ Dashboard 已启动: http://${'127.0.0.1'}:${port}${colors.reset}`);
            console.log(`${colors.dim}   输入 /dashboard 关闭\n${colors.reset}`);
          });
        }
        prompt();
        return;
      }

      // ---- 正常对话 ----
      try {
        await agent.run(trimmed);
        console.log('\n');
        hasUnsavedChanges = true;

        // 自动保存（每轮对话后）
        currentSessionId = updateSessionAndSave(agent, currentSessionId);
      } catch (err: any) {
        console.error(`\n${colors.red}❌ 错误: ${err.message}${colors.reset}\n`);
      }

      prompt();
    });
  };

  prompt();
}

// ============================================
// 单次对话模式
// ============================================

async function runOnce(config: AppConfig, prompt: string) {
  const provider = createProvider(config);
  const agent = new AgentLoop(provider);
  await agent.run(prompt);
}

// ============================================
// 主入口
// ============================================

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  console.log('govpm-copilot v0.3.0');
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${colors.cyan}GovPM Copilot${colors.reset} - 政府项目全流程自动化助手 v0.4

${colors.bold}用法:${colors.reset}
  govpm                  进入交互模式
  govpm --chat "问题"     单次对话模式
  govpm --version        查看版本
  govpm --help           查看帮助

${colors.bold}环境变量:${colors.reset}
  DASHSCOPE_API_KEY      阿里百炼 API Key
  ANTHROPIC_API_KEY      Anthropic API Key
  GOVPM_PROVIDER         LLM 提供商 (dashscope|anthropic)
  GOVPM_MODEL            模型名称
  LLM_BASE_URL           自定义 API 地址

${colors.bold}快捷键:${colors.reset}
  Ctrl+C                 中断当前请求
  Escape                 中断当前请求
  Ctrl+C × 2             退出程序
`);
  process.exit(0);
}

// 单次对话模式: govpm --chat "问题"
const chatIdx = args.indexOf('--chat');
if (chatIdx !== -1 && args[chatIdx + 1]) {
  const config = loadConfig();
  runOnce(config, args[chatIdx + 1])
    .then(() => process.exit(0))
    .catch((err) => { console.error(`${colors.red}❌${colors.reset}`, err.message); process.exit(1); });
} else {
  // 默认进入 REPL
  runREPL(loadConfig());
}
