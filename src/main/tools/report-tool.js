/**
 * SoloForge - 报告生成工具
 * 允许 Agent 生成静态 HTML 报告
 * @module tools/report-tool
 */

const fs = require('fs').promises;
const path = require('path');
const { toolRegistry } = require('./tool-registry');
const { logger } = require('../utils/logger');
const { dataPath } = require('../account/data-path');

function getReportsDir() {
  return path.join(dataPath.getBasePath(), 'reports');
}

/**
 * 确保报告目录存在
 */
async function ensureReportsDir() {
  try {
    await fs.mkdir(getReportsDir(), { recursive: true });
  } catch (error) {
    // 目录已存在
  }
}

/**
 * 生成报告 ID
 * @returns {string}
 */
function generateReportId() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const random = Math.random().toString(36).slice(2, 6);
  return `report-${timestamp}-${random}`;
}

/**
 * HTML 报告模板
 * @param {Object} options
 * @param {string} options.title - 报告标题
 * @param {string} options.content - 报告内容（HTML）
 * @param {string} options.author - 作者（Agent 名称）
 * @param {string} options.createdAt - 创建时间
 * @returns {string}
 */
function generateHtmlTemplate(options) {
  const { title, content, author, createdAt } = options;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - SoloForge 报告</title>
  <style>
    :root {
      --primary: #3b82f6;
      --primary-dark: #2563eb;
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --text: #1e293b;
      --text-secondary: #64748b;
      --border: #e2e8f0;
      --success: #22c55e;
      --warning: #f59e0b;
      --danger: #ef4444;
    }
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 2rem;
    }
    
    .container {
      max-width: 1000px;
      margin: 0 auto;
    }
    
    .header {
      background: linear-gradient(135deg, var(--primary), var(--primary-dark));
      color: white;
      padding: 2rem;
      border-radius: 1rem;
      margin-bottom: 2rem;
      box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);
    }
    
    .header h1 {
      font-size: 1.75rem;
      margin-bottom: 0.5rem;
    }
    
    .header .meta {
      opacity: 0.9;
      font-size: 0.875rem;
    }
    
    .content {
      background: var(--card-bg);
      border-radius: 1rem;
      padding: 2rem;
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.1);
    }
    
    .content h2 {
      color: var(--primary-dark);
      border-bottom: 2px solid var(--border);
      padding-bottom: 0.5rem;
      margin: 1.5rem 0 1rem;
    }
    
    .content h2:first-child {
      margin-top: 0;
    }
    
    .content h3 {
      color: var(--text);
      margin: 1.25rem 0 0.75rem;
    }
    
    .content p {
      margin-bottom: 1rem;
    }
    
    .content ul, .content ol {
      margin-bottom: 1rem;
      padding-left: 1.5rem;
    }
    
    .content li {
      margin-bottom: 0.5rem;
    }
    
    .content table {
      width: 100%;
      border-collapse: collapse;
      margin: 1rem 0;
    }
    
    .content th, .content td {
      border: 1px solid var(--border);
      padding: 0.75rem;
      text-align: left;
    }
    
    .content th {
      background: var(--bg);
      font-weight: 600;
    }
    
    .content tr:hover {
      background: var(--bg);
    }
    
    .content code {
      background: #f1f5f9;
      padding: 0.125rem 0.375rem;
      border-radius: 0.25rem;
      font-size: 0.875rem;
      font-family: 'SF Mono', Monaco, monospace;
    }
    
    .content pre {
      background: #1e293b;
      color: #e2e8f0;
      padding: 1rem;
      border-radius: 0.5rem;
      overflow-x: auto;
      margin: 1rem 0;
    }
    
    .content pre code {
      background: none;
      padding: 0;
      color: inherit;
    }
    
    .stat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin: 1rem 0;
    }
    
    .stat-card {
      background: var(--bg);
      border-radius: 0.75rem;
      padding: 1.25rem;
      text-align: center;
    }
    
    .stat-card .value {
      font-size: 2rem;
      font-weight: 700;
      color: var(--primary);
    }
    
    .stat-card .label {
      color: var(--text-secondary);
      font-size: 0.875rem;
      margin-top: 0.25rem;
    }
    
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 500;
    }
    
    .badge-success {
      background: #dcfce7;
      color: #166534;
    }
    
    .badge-warning {
      background: #fef3c7;
      color: #92400e;
    }
    
    .badge-danger {
      background: #fee2e2;
      color: #991b1b;
    }
    
    .badge-info {
      background: #dbeafe;
      color: #1e40af;
    }
    
    .progress-bar {
      height: 0.5rem;
      background: var(--border);
      border-radius: 9999px;
      overflow: hidden;
      margin: 0.5rem 0;
    }
    
    .progress-bar .fill {
      height: 100%;
      background: var(--primary);
      border-radius: 9999px;
    }
    
    .footer {
      text-align: center;
      margin-top: 2rem;
      color: var(--text-secondary);
      font-size: 0.875rem;
    }
    
    @media print {
      body {
        background: white;
        padding: 0;
      }
      .header {
        background: var(--primary);
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">
        由 ${escapeHtml(author)} 生成 · ${createdAt}
      </div>
    </header>
    
    <main class="content">
      ${content}
    </main>
    
    <footer class="footer">
      <p>SoloForge - 多 Agent 协作系统</p>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * 转义 HTML 特殊字符
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return String(text).replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * 创建报告工具
 */
const createReportTool = {
  name: 'create_report',
  description: `生成 HTML 格式的报告。用于复杂的汇报、数据分析结果、工作总结等。
  
报告内容支持以下 HTML 元素：
- 标题：<h2>、<h3>
- 段落：<p>
- 列表：<ul>/<ol> + <li>
- 表格：<table>、<tr>、<th>、<td>
- 代码：<code>（行内）、<pre><code>（代码块）
- 统计卡片：<div class="stat-grid"><div class="stat-card"><div class="value">数值</div><div class="label">标签</div></div></div>
- 徽章：<span class="badge badge-success/warning/danger/info">文本</span>
- 进度条：<div class="progress-bar"><div class="fill" style="width: 75%"></div></div>`,
  category: 'file',
  parameters: {
    title: {
      type: 'string',
      description: '报告标题',
      required: true,
    },
    content: {
      type: 'string',
      description: '报告内容（HTML 格式，不需要包含 html/head/body 标签）',
      required: true,
    },
  },
  requiredPermissions: [],

  async execute(args, context) {
    const { title, content } = args;
    const author = context.agentName || context.agentId || 'Agent';

    await ensureReportsDir();

    const reportId = generateReportId();
    const createdAt = new Date().toLocaleString('zh-CN');
    const filename = `${reportId}.html`;
    const filepath = path.join(getReportsDir(), filename);

    const html = generateHtmlTemplate({
      title,
      content,
      author,
      createdAt,
    });

    await fs.writeFile(filepath, html, 'utf-8');

    logger.info('生成报告:', { reportId, title, author, filepath });

    return {
      success: true,
      reportId,
      title,
      author,
      filepath,
      // 返回可在消息中显示的预览链接格式
      viewUrl: `soloforge://report/${reportId}`,
      message: `报告已生成：${title}`,
    };
  },
};

/**
 * 获取报告列表工具
 */
const listReportsTool = {
  name: 'list_reports',
  description: '获取已生成的报告列表。',
  category: 'file',
  parameters: {
    limit: {
      type: 'number',
      description: '返回数量限制（默认 20）',
      required: false,
      default: 20,
    },
  },
  requiredPermissions: [],

  async execute(args) {
    const { limit = 20 } = args;

    await ensureReportsDir();

    const files = await fs.readdir(getReportsDir());
    const reports = [];

    for (const file of files.slice(-limit)) {
      if (!file.endsWith('.html')) continue;

      const filepath = path.join(getReportsDir(), file);
      const stat = await fs.stat(filepath);

      // 尝试从文件中提取标题
      let title = file.replace('.html', '');
      try {
        const content = await fs.readFile(filepath, 'utf-8');
        const titleMatch = content.match(/<title>([^<]+) - SoloForge 报告<\/title>/);
        if (titleMatch) {
          title = titleMatch[1];
        }
      } catch {
        // 忽略读取错误
      }

      reports.push({
        id: file.replace('.html', ''),
        title,
        filepath,
        createdAt: stat.mtime.toISOString(),
      });
    }

    // 按时间倒序
    reports.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return {
      count: reports.length,
      reports,
    };
  },
};

/**
 * 注册报告工具
 */
function registerReportTools() {
  toolRegistry.register(createReportTool);
  toolRegistry.register(listReportsTool);
}

/**
 * 获取报告内容
 * @param {string} reportId
 * @returns {Promise<string | null>}
 */
async function getReportContent(reportId) {
  const filepath = path.join(getReportsDir(), `${reportId}.html`);
  try {
    return await fs.readFile(filepath, 'utf-8');
  } catch {
    return null;
  }
}

module.exports = {
  createReportTool,
  listReportsTool,
  registerReportTools,
  getReportContent,
  getReportsDir,
};
