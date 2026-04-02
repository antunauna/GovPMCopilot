#!/usr/bin/env node
/**
 * GovPMCopilot v0.2 - CLI 入口
 * 政府项目全流程自动化助手
 */

import { createInterface } from 'readline';
import { loadConfig, saveConfig } from './config.js';
import { AnthropicProvider, DashScopeProvider } from './providers/index.js';
import { AgentLoop } from './agent/loop.js';
import { getAllTools } from './tools/index.js';
import type { LLMProvider, AppConfig } from './types.js';

// ============================================
// 创建 Provider
// ============================================

function createProvider(config: AppConfig): LLMProvider {
  if (!config.apiKey) {
    console.error('❌ 未配置 API Key。请设置环境变量：');
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
  const provider = createProvider(config);
  const agent = new AgentLoop(provider);

  console.log(`
╔══════════════════════════════════════════════════╗
║       GovPM Copilot v0.2                        ║
║       政府项目全流程自动化助手                     ║
╠══════════════════════════════════════════════════╣
║  Provider: ${config.provider.padEnd(36)}║
║  Model:    ${(config.model || 'default').padEnd(36)}║
║  工具数:   ${String(getAllTools().length).padEnd(36)}║
╠══════════════════════════════════════════════════╣
║  输入问题开始对话，/quit 退出，/help 查看帮助     ║
╚══════════════════════════════════════════════════╝
`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () => {
    rl.question('> ', async (input) => {
      const trimmed = input.trim();

      if (!trimmed) { prompt(); return; }

      // 命令处理
      if (trimmed === '/quit' || trimmed === '/exit') {
        console.log('👋 再见！');
        rl.close();
        process.exit(0);
      }

      if (trimmed === '/help') {
        console.log(`
  可用命令:
    /help      - 显示帮助
    /quit      - 退出
    /status    - 当前状态
    /tools     - 列出工具
    /clear     - 清空对话历史
    /compact   - 手动压缩上下文
    /config    - 显示配置
`);
        prompt();
        return;
      }

      if (trimmed === '/tools') {
        console.log('\n可用工具:');
        for (const tool of getAllTools()) {
          console.log(`  🔧 ${tool.def.name.padEnd(20)} ${tool.def.description}`);
        }
        console.log('');
        prompt();
        return;
      }

      if (trimmed === '/clear') {
        agent.loadMessages([]);
        console.log('✅ 对话历史已清空\n');
        prompt();
        return;
      }

      if (trimmed === '/status') {
        console.log(`\n  上下文 Token: ~${agent.contextTokenCount()}`);
        console.log(`  消息数: ${agent.getMessages().length}\n`);
        prompt();
        return;
      }

      if (trimmed === '/config') {
        console.log(`\n  Provider: ${config.provider}`);
        console.log(`  Model:    ${config.model}`);
        console.log(`  DataDir:  ${config.dataDir}\n`);
        prompt();
        return;
      }

      // 正常对话
      try {
        await agent.run(trimmed);
        console.log('\n');
      } catch (err: any) {
        console.error(`\n❌ 错误: ${err.message}\n`);
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
  console.log('govpm-copilot v0.2.0');
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
GovPM Copilot - 政府项目全流程自动化助手 v0.2

用法:
  govpm                  进入交互模式
  govpm --chat "问题"     单次对话模式
  govpm --version        查看版本
  govpm --help           查看帮助

环境变量:
  DASHSCOPE_API_KEY      阿里百炼 API Key
  ANTHROPIC_API_KEY      Anthropic API Key
  GOVPM_PROVIDER         LLM 提供商 (dashscope|anthropic)
  GOVPM_MODEL            模型名称
`);
  process.exit(0);
}

// 单次对话模式: govpm --chat "问题"
const chatIdx = args.indexOf('--chat');
if (chatIdx !== -1 && args[chatIdx + 1]) {
  const config = loadConfig();
  runOnce(config, args[chatIdx + 1])
    .then(() => process.exit(0))
    .catch((err) => { console.error('❌', err.message); process.exit(1); });
} else {
  // 默认进入 REPL
  runREPL(loadConfig());
}
