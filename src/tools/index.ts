/**
 * 工具集
 * 文件读写 + 工具列表
 * 联网搜索已通过 DashScope enable_search 原生支持，无需独立工具
 */

import { promises as fs } from 'fs';
import { resolve } from 'path';
import type { Tool, ToolContext } from '../types.js';

// ============================================
// 通用工具
// ============================================

/** 读取文件 */
export const readFileTool: Tool = {
  def: {
    name: 'read_file',
    description: '读取指定路径的文件内容。支持读取项目目录内的任意文件。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（相对于工作目录或绝对路径）' },
      },
      required: ['path'],
    },
  },
  permission: 'auto',
  async execute(input, ctx) {
    const filePath = resolve(ctx.workDir, input.path as string);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      // 截断过长内容
      if (content.length > 50000) {
        return content.slice(0, 50000) + '\n\n... [文件过长，已截断，共 ' + content.length + ' 字符]';
      }
      return content;
    } catch (err: any) {
      return `读取文件失败: ${err.message}`;
    }
  },
};

/** 写入文件 */
export const writeFileTool: Tool = {
  def: {
    name: 'write_file',
    description: '将内容写入指定路径的文件。如果文件已存在则覆盖。谨慎使用。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径' },
        content: { type: 'string', description: '要写入的内容' },
      },
      required: ['path', 'content'],
    },
  },
  permission: 'confirm',
  async execute(input, ctx) {
    const filePath = resolve(ctx.workDir, input.path as string);
    try {
      await fs.mkdir(resolve(filePath, '..'), { recursive: true });
      await fs.writeFile(filePath, input.content as string, 'utf-8');
      return `文件已写入: ${filePath}`;
    } catch (err: any) {
      return `写入文件失败: ${err.message}`;
    }
  },
};

// ============================================
// Meta 工具
// ============================================

/** 列出可用工具（meta 工具） */
export const listToolsTool: Tool = {
  def: {
    name: 'list_tools',
    description: '列出所有可用的工具及其描述。',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  permission: 'auto',
  async execute(_input, _ctx) {
    return '所有工具: ' + getAllTools().map(t => `${t.def.name} - ${t.def.description}`).join('\n');
  },
};

// ============================================
// 工具注册
// ============================================

const allTools: Tool[] = [
  readFileTool,
  writeFileTool,
  listToolsTool,
];

export function getAllTools(): Tool[] {
  return [...allTools];
}

export function getTool(name: string): Tool | undefined {
  return allTools.find(t => t.def.name === name);
}

export function getToolDefs() {
  return allTools.map(t => t.def);
}
