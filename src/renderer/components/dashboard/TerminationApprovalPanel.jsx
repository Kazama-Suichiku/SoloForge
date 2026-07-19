import { useState, useCallback } from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { TERM_STATUS_COLORS, TERM_STATUS_LABELS, TERM_PAGE_SIZE } from './constants';
import { formatDateTime } from './utils';
import { ChevronIcon, DetailField, EmptyState } from './ui';

/**
 * 开除审批面板
 * props: { requests: Array, onRefresh: Function }
 */
export default function TerminationApprovalPanel({ requests, onRefresh }) {
  const [expandedId, setExpandedId] = useState(null);
  const [decidingId, setDecidingId] = useState(null);
  const [comment, setComment] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showOnlyPending, setShowOnlyPending] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const handleDecide = useCallback(async (requestId, approved) => {
    setDecidingId(requestId);
    try {
      const result = await window.electronAPI.terminationDecide({
        requestId,
        approved,
        comment: comment.trim() || (approved ? '批准开除' : '不予开除'),
      });
      if (result.success) {
        setComment('');
        setExpandedId(null);
        if (onRefresh) onRefresh();
      } else {
        console.error('审批失败:', result.error);
      }
    } catch (error) {
      console.error('审批操作异常:', error);
    } finally {
      setDecidingId(null);
    }
  }, [comment, onRefresh]);

  // 清空已处理的记录
  const handleClearProcessed = useCallback(async () => {
    if (!window.confirm('确定要清空所有已处理的开除记录吗？（待审批的不会被清空）')) return;
    setIsClearing(true);
    try {
      const result = await window.electronAPI.clearProcessedTerminations?.();
      if (result?.success) {
        setCurrentPage(1);
        if (onRefresh) onRefresh();
      } else {
        console.error('清空失败:', result?.error);
      }
    } catch (error) {
      console.error('清空操作异常:', error);
    } finally {
      setIsClearing(false);
    }
  }, [onRefresh]);

  if (!requests || requests.length === 0) {
    return <EmptyState icon={ExclamationTriangleIcon} message="暂无开除申请" />;
  }

  // 待处理的排在前面
  const sorted = [...requests].sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  // 过滤（可选只看待审批）
  const filtered = showOnlyPending ? sorted.filter(r => r.status === 'pending') : sorted;

  // 分页
  const totalPages = Math.ceil(filtered.length / TERM_PAGE_SIZE);
  const startIdx = (currentPage - 1) * TERM_PAGE_SIZE;
  const paginatedRequests = filtered.slice(startIdx, startIdx + TERM_PAGE_SIZE);

  // 统计
  const pendingCount = requests.filter(r => r.status === 'pending').length;
  const processedCount = requests.filter(r => r.status !== 'pending').length;

  return (
    <div className="space-y-2">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-[var(--border-color)]/50">
        <div className="flex items-center gap-2">
          {/* 筛选开关 */}
          <button
            onClick={() => { setShowOnlyPending(!showOnlyPending); setCurrentPage(1); }}
            className={`px-2 py-1 text-xs rounded-full transition-colors ${
              showOnlyPending
                ? 'bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-300'
                : 'bg-bg-muted text-text-secondary hover:bg-[var(--bg-hover)]'
            }`}
          >
            {showOnlyPending ? `待审批 (${pendingCount})` : `全部 (${filtered.length})`}
          </button>
          {!showOnlyPending && pendingCount > 0 && (
            <span className="text-xs text-text-muted">{pendingCount} 待审批</span>
          )}
        </div>

        {/* 清空按钮 */}
        {processedCount > 0 && (
          <button
            onClick={handleClearProcessed}
            disabled={isClearing}
            className="px-2 py-1 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors disabled:opacity-50"
          >
            {isClearing ? '清空中...' : `清空已处理 (${processedCount})`}
          </button>
        )}
      </div>

      {/* 列表 */}
      {paginatedRequests.map((req) => {
        const isExpanded = expandedId === req.id;
        const isPending = req.status === 'pending';
        const isDeciding = decidingId === req.id;

        return (
          <div
            key={req.id}
            className={`rounded-lg transition-colors ${
              isExpanded
                ? isPending
                  ? 'bg-orange-50/50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800'
                  : 'bg-[var(--bg-hover)] border border-[var(--border-color)]'
                : isPending
                  ? 'hover:bg-orange-50/30 dark:hover:bg-orange-950/10 border border-transparent'
                  : 'hover:bg-[var(--bg-hover)] border border-transparent'
            }`}
          >
            <button
              type="button"
              className="w-full flex items-center gap-3 p-2.5 text-left"
              onClick={() => {
                setExpandedId(isExpanded ? null : req.id);
                setComment('');
              }}
            >
              <ChevronIcon expanded={isExpanded} />
              <div className="w-7 h-7 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center shrink-0">
                <ExclamationTriangleIcon className="w-3.5 h-3.5 text-red-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary truncate">
                  {req.agentName || req.agentId}
                  {req.agentTitle && <span className="text-text-muted ml-1">({req.agentTitle})</span>}
                </p>
                <p className="text-xs text-text-secondary truncate">
                  {req.proposedByName || req.proposedBy} 提出 · {formatDateTime(req.createdAt)}
                </p>
              </div>
              <span className={`px-2 py-0.5 text-xs rounded-full shrink-0 ${TERM_STATUS_COLORS[req.status] || TERM_STATUS_COLORS.pending}`}>
                {TERM_STATUS_LABELS[req.status] || req.status}
              </span>
            </button>

            {isExpanded && (
              <div className="px-3 pb-3 pt-1 border-t border-[var(--border-color)]/50 ml-9">
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <DetailField label="员工" value={`${req.agentName} (${req.agentTitle || '未知职位'})`} />
                  <DetailField label="部门" value={req.department || '未知'} />
                  <DetailField label="提出人" value={req.proposedByName || req.proposedBy} />
                  <DetailField label="严重程度" value={req.severity === 'urgent' ? '紧急' : '一般'} />
                  <DetailField label="申请时间" value={formatDateTime(req.createdAt)} className="col-span-2" />
                </div>

                {/* 开除原因 */}
                <div className="mt-3 p-2.5 bg-bg-muted rounded-lg">
                  <span className="text-xs text-text-muted">开除原因</span>
                  <p className="text-sm text-text-primary mt-1">{req.reason || '未说明'}</p>
                </div>

                {/* 影响分析 */}
                {req.impactAnalysis && (
                  <div className="mt-2 p-2.5 bg-bg-muted rounded-lg">
                    <span className="text-xs text-text-muted">影响分析</span>
                    <p className="text-sm text-text-primary mt-1">{req.impactAnalysis}</p>
                  </div>
                )}

                {/* 已处理的显示结果 */}
                {req.status !== 'pending' && req.bossComment && (
                  <div className="mt-2 p-2.5 bg-bg-muted rounded-lg">
                    <span className="text-xs text-text-muted">老板批示</span>
                    <p className="text-sm text-text-primary mt-1">{req.bossComment}</p>
                  </div>
                )}
                {req.confirmedAt && (
                  <p className="text-xs text-text-muted mt-2">处理时间: {formatDateTime(req.confirmedAt)}</p>
                )}

                {/* 待处理的审批操作区 */}
                {isPending && (
                  <div className="mt-4 pt-3 border-t border-[var(--border-color)]/50">
                    {/* 批示输入 */}
                    <div className="mb-3">
                      <label className="text-xs text-text-muted mb-1 block">批示意见（可选）</label>
                      <input
                        type="text"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="输入批示意见..."
                        className="w-full px-3 py-1.5 text-sm bg-bg-base border border-[var(--border-color)] rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-text-primary placeholder-text-muted"
                        disabled={isDeciding}
                      />
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDecide(req.id, true); }}
                        disabled={isDeciding}
                        className="flex-1 px-3 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                      >
                        {isDeciding ? '处理中...' : '批准开除'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDecide(req.id, false); }}
                        disabled={isDeciding}
                        className="flex-1 px-3 py-2 text-sm font-medium text-text-primary bg-bg-muted hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors border border-[var(--border-color)]"
                      >
                        {isDeciding ? '处理中...' : '拒绝开除'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* 分页控件 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-3 border-t border-[var(--border-color)]/50">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary hover:bg-[var(--bg-hover)] rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            上一页
          </button>
          <span className="text-xs text-text-muted">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary hover:bg-[var(--bg-hover)] rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
