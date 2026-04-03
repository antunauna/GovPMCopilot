/**
 * 成本监控 Dashboard
 * 轻量级 HTTP 服务器，用原生 http 模块，零依赖
 * 在 REPL 中通过 /dashboard 命令启动
 */

import { createServer, type Server } from 'http';
import type { CostTracker } from './session.js';

const DASHBOARD_PORT = 8765;
const DASHBOARD_HOST = '127.0.0.1';

/** 生成 Dashboard HTML */
function generateHTML(tracker: CostTracker): string {
  const daily = tracker.daily.slice(-30);
  const maxCost = Math.max(...daily.map(d => d.estimatedCost), 0.01);
  const allTime = tracker.allTime;

  const dailyRows = daily.map(d => {
    const barWidth = Math.min((d.estimatedCost / maxCost) * 100, 100);
    const barColor = d.estimatedCost > 0.1 ? '#ef4444' : d.estimatedCost > 0.05 ? '#f59e0b' : '#22c55e';
    return `
      <tr>
        <td class="date">${d.date}</td>
        <td>${d.totalInput.toLocaleString()}</td>
        <td>${d.totalOutput.toLocaleString()}</td>
        <td>${d.requestCount}</td>
        <td class="cost">¥${d.estimatedCost.toFixed(4)}</td>
        <td class="bar-cell">
          <div class="bar" style="width:${barWidth}%;background:${barColor}"></div>
        </td>
      </tr>`;
  }).reverse().join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GovPM Copilot - 成本监控</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; min-height: 100vh; }
  .container { max-width: 960px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 0.5rem; color: #38bdf8; }
  .subtitle { color: #64748b; margin-bottom: 2rem; font-size: 0.9rem; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .card { background: #1e293b; border-radius: 12px; padding: 1.5rem; border: 1px solid #334155; }
  .card-label { font-size: 0.8rem; color: #64748b; margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .card-value { font-size: 1.8rem; font-weight: 700; }
  .card-value.green { color: #22c55e; }
  .card-value.blue { color: #38bdf8; }
  .card-value.yellow { color: #f59e0b; }
  .card-value.red { color: #ef4444; }
  .section-title { font-size: 1.1rem; margin-bottom: 1rem; color: #94a3b8; }
  table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 12px; overflow: hidden; border: 1px solid #334155; }
  th { text-align: left; padding: 0.75rem 1rem; background: #334155; font-size: 0.8rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
  td { padding: 0.6rem 1rem; border-top: 1px solid #1e293b; font-size: 0.9rem; }
  tr:hover td { background: #334155; }
  .date { color: #94a3b8; }
  .cost { color: #f59e0b; font-weight: 600; }
  .bar-cell { width: 200px; }
  .bar { height: 8px; border-radius: 4px; min-width: 2px; transition: width 0.3s; }
  .empty { text-align: center; padding: 3rem; color: #475569; }
  .auto-refresh { color: #475569; font-size: 0.8rem; margin-top: 1rem; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  .live-dot { display: inline-block; width: 8px; height: 8px; background: #22c55e; border-radius: 50%; margin-right: 6px; animation: pulse 2s infinite; }
</style>
</head>
<body>
<div class="container">
  <h1><span class="live-dot"></span>成本监控 Dashboard</h1>
  <p class="subtitle">GovPM Copilot v0.4 - Token 使用与费用追踪</p>

  <div class="cards">
    <div class="card">
      <div class="card-label">总输入 Tokens</div>
      <div class="card-value blue">${allTime.totalInput.toLocaleString()}</div>
    </div>
    <div class="card">
      <div class="card-label">总输出 Tokens</div>
      <div class="card-value green">${allTime.totalOutput.toLocaleString()}</div>
    </div>
    <div class="card">
      <div class="card-label">总请求数</div>
      <div class="card-value yellow">${allTime.requestCount.toLocaleString()}</div>
    </div>
    <div class="card">
      <div class="card-label">累计费用</div>
      <div class="card-value red">¥${allTime.estimatedCost.toFixed(4)}</div>
    </div>
  </div>

  <div class="section-title">每日明细（最近 30 天）</div>
  ${daily.length > 0 ? `
  <table>
    <thead>
      <tr><th>日期</th><th>输入 Tokens</th><th>输出 Tokens</th><th>请求数</th><th>费用</th><th>趋势</th></tr>
    </thead>
    <tbody>${dailyRows}</tbody>
  </table>` : '<div class="empty">暂无数据。开始对话后将自动记录。</div>'}

  <p class="auto-refresh">自动刷新：30s | 按 Ctrl+C 关闭 Dashboard</p>
</div>
<script>
  // 自动刷新
  setTimeout(() => location.reload(), 30000);
</script>
</body>
</html>`;
}

/** 启动 Dashboard 服务器 */
export function startDashboard(tracker: CostTracker, onPort: (port: number) => void): Server {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(generateHTML(tracker));
  });

  server.listen(DASHBOARD_PORT, DASHBOARD_HOST, () => {
    onPort(DASHBOARD_PORT);
  });

  return server;
}

export { DASHBOARD_PORT, DASHBOARD_HOST };
