/**
 * 配置管理
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { AppConfig, ProviderType } from './types.js';

const CONFIG_DIR = join(homedir(), '.govpm');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const DEFAULTS: AppConfig = {
  provider: 'dashscope',
  model: 'qwen-plus',
  apiKey: '',
  dataDir: join(process.cwd(), 'govpm-data'),
  maxTokens: 8192,
  temperature: 0.7,
  verbose: false,
};

/** 加载配置（环境变量 > 配置文件 > 默认值） */
export function loadConfig(): AppConfig {
  const config = { ...DEFAULTS };

  // 读取配置文件
  if (existsSync(CONFIG_FILE)) {
    try {
      const fileConfig = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
      Object.assign(config, fileConfig);
    } catch { /* 忽略 */ }
  }

  // 环境变量覆盖
  if (process.env.ANTHROPIC_API_KEY && config.provider === 'anthropic') {
    config.apiKey = process.env.ANTHROPIC_API_KEY;
  }
  if (process.env.DASHSCOPE_API_KEY) {
    config.apiKey = process.env.DASHSCOPE_API_KEY;
    if (process.env.GOVPM_PROVIDER) config.provider = process.env.GOVPM_PROVIDER as ProviderType;
  }
  if (process.env.GOVPM_MODEL) config.model = process.env.GOVPM_MODEL;
  if (process.env.GOVPM_DATA_DIR) config.dataDir = process.env.GOVPM_DATA_DIR;
  if (process.env.LLM_BASE_URL) config.baseUrl = process.env.LLM_BASE_URL;

  return config;
}

/** 保存配置到文件 */
export function saveConfig(partial: Partial<AppConfig>): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const current = loadConfig();
  const merged = { ...current, ...partial };
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8');
}
