/**
 * SoloForge - 同步变更 / 冲突 Diff 展示
 *
 * 云同步采用 LWW（server_rev 比较），理论无冲突。本组件展示「最近变更」视图：
 *  - 按 sync-store.conflicts 列表（变更摘要）分类展示：会话/消息/Agent/Boss/文档
 *  - 对文档类（operations/projects/budgets）做行级文本 diff
 *    （读取本地文件当前内容与最近一次 pull 的远程内容对比；不引入第三方 diff 库）
 *
 * Linear 风格：diff 视图用半透明绿/红背景。
 *
 * 数据来源：
 *  - conflicts: Array<{ type, op, count, detail? }> （来自 sync-store.extractChanges）
 *  - documentDiffs: 可选的 prop，父组件可传入 { [dataType]: { before, after } } 用于精确 diff
 *    若未传入，则仅展示统计摘要
 *
 * @module components/sync/ConflictDiff
 */

import React, { useMemo, useState } from 'react';
import {
  ArrowsRightLeftIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  DocumentTextIcon,
  ChatBubbleLeftRightIcon,
  UserGroupIcon,
  CpuChipIcon,
  ClipboardDocumentCheckIcon,
} from '@heroicons/react/24/outline';

// ─── 文档类型标签映射 ─────────────────────────────────────────
const TYPE_META = {
  conversations: { label: '会话', icon: ChatBubbleLeftRightIcon, color: 'var(--accent)' },
  messages:      { label: '消息', icon: ChatBubbleLeftRightIcon, color: 'var(--accent)' },
  agents:        { label: 'Agent', icon: UserGroupIcon, color: 'var(--accent)' },
  boss:          { label: 'Boss 配置', icon: CpuChipIcon, color: 'var(--color-warning)' },
  documents:     { label: '文档', icon: DocumentTextIcon, color: 'var(--color-success)' },
  operations:    { label: '运营', icon: ClipboardDocumentCheckIcon, color: 'var(--color-success)' },
  projects:      { label: '项目', icon: ClipboardDocumentCheckIcon, color: 'var(--color-success)' },
  budgets:       { label: '预算', icon: ClipboardDocumentCheckIcon, color: 'var(--color-success)' },
};

// ─── 简单行级 diff（LCS，O(n*m)）─────────────────────────────
/**
 * 计算两个字符串数组的 LCS 最长公共子序列长度表。
 * 用于行级 diff。不引入第三方库。
 */
function lcsTable(a, b) {
  const n = a.length, m = b.length;
  // 用 Uint16 节省内存；行数+1 列数+1
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    dp[i] = new Uint16Array(m + 1);
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

/**
 * 基于 LCS 生成行级 diff。
 * @returns {Array<{op:'equal'|'add'|'del', text:string}>}
 */
function lineDiff(beforeText, afterText) {
  const a = (beforeText || '').split('\n');
  const b = (afterText || '').split('\n');
  const dp = lcsTable(a, b);
  const result = [];
  let i = a.length, j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.push({ op: 'equal', text: a[i - 1] });
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      result.push({ op: 'del', text: a[i - 1] });
      i--;
    } else {
      result.push({ op: 'add', text: b[j - 1] });
      j--;
    }
  }
  while (i > 0) { result.push({ op: 'del', text: a[i - 1] }); i--; }
  while (j > 0) { result.push({ op: 'add', text: b[j - 1] }); j--; }
  result.reverse();
  return result;
}

// ─── 单条变更摘要行 ─────────────────────────────────────────
function ChangeRow({ change }) {
  const meta = TYPE_META[change.type] || { label: change.type, icon: ArrowsRightLeftIcon, color: 'var(--text-tertiary)' };
  const Icon = meta.icon;
  const isPull = change.op === 'pull';
  const OpIcon = isPull ? ArrowDownTrayIcon : ArrowUpTrayIcon;
  const opColor = isPull ? 'var(--accent)' : 'var(--color-success)';
  const opLabel = isPull ? '拉取' : '推送';

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-bg-hover transition-colors">
      <Icon className="w-4 h-4 flex-shrink-0" style={{ color: meta.color }} aria-hidden="true" />
      <span className="text-sm text-text-primary flex-shrink-0">{meta.label}</span>
      <span className="inline-flex items-center gap-1 text-xs flex-shrink-0" style={{ color: opColor }}>
        <OpIcon className="w-3.5 h-3.5" aria-hidden="true" />
        {opLabel}
      </span>
      <span className="text-sm font-mono text-text-secondary">
        ×{change.count}
      </span>
      {change.detail && change.detail.length > 0 && (
        <span className="text-xs text-text-tertiary truncate" title={change.detail.map((d) => d.id).join(', ')}>
          {change.detail.map((d) => d.dataType || d.id).join(', ')}
        </span>
      )}
    </div>
  );
}

// ─── 文档 diff 面板 ─────────────────────────────────────────
function DocumentDiff({ dataType, before, after }) {
  const [collapsed, setCollapsed] = useState(false);
  const diff = useMemo(() => lineDiff(before, after), [before, after]);

  // 统计变更行数
  const added = diff.filter((d) => d.op === 'add').length;
  const deleted = diff.filter((d) => d.op === 'del').length;
  const meta = TYPE_META[dataType] || TYPE_META.documents;

  return (
    <div className="card !p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-hover transition-colors text-left"
        aria-expanded={!collapsed}
      >
        <meta.icon className="w-4 h-4" style={{ color: meta.color }} aria-hidden="true" />
        <span className="text-sm font-ui text-text-primary">{meta.label}</span>
        <span className="text-xs text-text-secondary font-mono">{dataType}</span>
        <span className="ml-auto flex items-center gap-2 text-xs">
          <span style={{ color: 'var(--color-success)' }}>+{added}</span>
          <span style={{ color: 'var(--color-danger)' }}>-{deleted}</span>
          <span className="text-text-tertiary">{collapsed ? '展开' : '折叠'}</span>
        </span>
      </button>
      {!collapsed && (
        <div
          className="max-h-72 overflow-auto font-mono text-xs leading-relaxed"
          style={{ backgroundColor: 'var(--bg-base)', fontFamily: 'var(--font-mono)' }}
        >
          {diff.length === 0 && (
            <div className="px-3 py-2 text-text-tertiary italic">无内容</div>
          )}
          {diff.map((line, idx) => {
            let cls = 'text-text-secondary';
            let prefix = ' ';
            let bg = '';
            if (line.op === 'add') {
              cls = '';
              prefix = '+';
              // 半透明绿背景
              bg = 'rgba(74,222,128,0.10)';
            } else if (line.op === 'del') {
              cls = '';
              prefix = '-';
              // 半透明红背景
              bg = 'rgba(248,113,113,0.10)';
            }
            const lineColor =
              line.op === 'add' ? 'var(--color-success)' :
              line.op === 'del' ? 'var(--color-danger)' :
              'var(--text-secondary)';
            return (
              <div key={idx} className="flex" style={{ backgroundColor: bg }}>
                <span
                  className="select-none w-8 flex-shrink-0 text-right pr-2 border-r"
                  style={{ color: 'var(--text-tertiary)', borderColor: 'var(--border-default)' }}
                >
                  {idx + 1}
                </span>
                <span className="pl-2 pr-3 whitespace-pre-wrap break-all" style={{ color: lineColor }}>
                  <span className="select-none mr-1 opacity-60">{prefix}</span>
                  {line.text || '\u00a0'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * @param {Object} props
 * @param {Array} [props.conflicts] - sync-store.conflicts（变更摘要列表）
 * @param {Object} [props.documentDiffs] - { [dataType]: { before, after } } 可选，精确文档 diff
 * @param {Function} [props.onClear] - 清空按钮回调
 * @param {string} [props.className]
 */
export default function ConflictDiff({ conflicts = [], documentDiffs = {}, onClear, className = '' }) {
  const hasChanges = conflicts.length > 0;
  const docTypes = Object.keys(documentDiffs);

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-ui text-text-primary flex items-center gap-2">
          <ArrowsRightLeftIcon className="w-4 h-4 text-text-secondary" aria-hidden="true" />
          最近变更
        </h3>
        {hasChanges && onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
          >
            清空
          </button>
        )}
      </div>

      {!hasChanges && docTypes.length === 0 && (
        <div className="text-sm text-text-tertiary py-6 text-center italic">
          最近一次同步无变更
        </div>
      )}

      {hasChanges && (
        <div className="flex flex-col divide-y divide-border-default">
          {conflicts.map((c, idx) => (
            <ChangeRow key={`${c.type}-${c.op}-${idx}`} change={c} />
          ))}
        </div>
      )}

      {docTypes.length > 0 && (
        <div className="flex flex-col gap-2">
          {docTypes.map((dt) => {
            const { before = '', after = '' } = documentDiffs[dt] || {};
            return (
              <DocumentDiff key={dt} dataType={dt} before={before} after={after} />
            );
          })}
        </div>
      )}
    </div>
  );
}

export { lineDiff, lcsTable };
