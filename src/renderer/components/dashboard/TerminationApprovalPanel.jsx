import { useState, useCallback } from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { TERM_STATUS_TONES, TERM_STATUS_LABELS, TERM_PAGE_SIZE } from './constants';
import { formatDateTime } from './utils';
import { ChevronIcon, DetailField, EmptyState, Badge } from './ui';

/**
 * 开除审批面板 —— 确认按钮 danger 色，pill badge
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
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          {/* 筛选开关 —— pill 切换 */}
          <button
            onClick={() => { setShowOnlyPending(!showOnlyPending); setCurrentPage(1); }}
            className={`px-2 py-1 text-xs rounded-full transition-colors-fast ${
              showOnlyPending
                ? 'text-warning'
                : 'text-text-tertiary hover:text-text-secondary'
            }`}
            style={{ backgroundColor: showOnlyPending ? 'rgba(251,191,36,0.08)' : 'rgba(255,255,255,0.04)' }}
          >
            {showOnlyPending ? `待审批 (${pendingCount})` : `全部 (${filtered.length})`}
          </button>
          {!showOnlyPending && pendingCount > 0 && (
            <span className="text-xs text-text-quaternary">{pendingCount} 待审批</span>
          )}
        </div>

        {/* 清空按钮 */}
        {processedCount > 0 && (
          <button
            onClick={handleClearProcessed}
            disabled={isClearing}
            className="px-2 py-1 text-xs text-danger hover:text-danger-hover rounded-sm transition-colors-fast disabled:opacity-50"
          >
            {isClearing ? '清空中…' : `清空已处理 (${processedCount})`}
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
            className={`group relative rounded-md border ${
              isExpanded
                ? isPending
                  ? 'border-border-default'
                  : 'border-border-subtle'
                : isPending
                  ? 'border-transparent hover:border-border-default'
                  : 'border-transparent hover:border-border-default'
            }`}
          >
            {/* Emil: hover opacity 背景层（不触发 background-color 重绘） */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ backgroundColor: 'var(--bg-hover)' }}
            />
            {isExpanded && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-md"
                style={{ backgroundColor: 'var(--bg-hover)', opacity: 1 }}
              />
            )}
            <button
              type="button"
              className="w-full flex items-center gap-3 p-2.5 text-left"
              onClick={() => {
                setExpandedId(isExpanded ? null : req.id);
                setComment('');
              }}
            >
              <ChevronIcon expanded={isExpanded} />
              <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'rgba(248,113,113,0.08)' }}>
                <ExclamationTriangleIcon className="w-3 h-3 text-danger" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary truncate">
                  {req.agentName || req.agentId}
                  {req.agentTitle && <span className="text-text-quaternary ml-1">({req.agentTitle})</span>}
                </p>
                <p className="text-xs text-text-tertiary truncate">
                  {req.proposedByName || req.proposedBy} 提出 · {formatDateTime(req.createdAt)}
                </p>
              </div>
              <Badge tone={TERM_STATUS_TONES[req.status] || 'neutral'}>
                {TERM_STATUS_LABELS[req.status] || req.status}
              </Badge>
            </button>

            {isExpanded && (
              <div className="px-3 pb-3 pt-2 ml-9 mr-3 border-t border-border-subtle">
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <DetailField label="员工" value={`${req.agentName} (${req.agentTitle || '未知职位'})`} />
                  <DetailField label="部门" value={req.department || '未知'} />
                  <DetailField label="提出人" value={req.proposedByName || req.proposedBy} />
                  <DetailField label="严重程度" value={req.severity === 'urgent' ? '紧急' : '一般'} />
                  <DetailField label="申请时间" value={formatDateTime(req.createdAt)} className="col-span-2" />
                </div>

                {/* 开除原因 */}
                <div className="mt-3 p-2.5 rounded-md border border-border-subtle">
                  <span className="text-xs text-text-quaternary">开除原因</span>
                  <p className="text-sm text-text-secondary mt-1 leading-snug">{req.reason || '未说明'}</p>
                </div>

                {/* 影响分析 */}
                {req.impactAnalysis && (
                  <div className="mt-2 p-2.5 rounded-md border border-border-subtle">
                    <span className="text-xs text-text-quaternary">影响分析</span>
                    <p className="text-sm text-text-secondary mt-1 leading-snug">{req.impactAnalysis}</p>
                  </div>
                )}

                {/* 已处理的显示结果 */}
                {req.status !== 'pending' && req.bossComment && (
                  <div className="mt-2 p-2.5 rounded-md border border-border-subtle">
                    <span className="text-xs text-text-quaternary">老板批示</span>
                    <p className="text-sm text-text-secondary mt-1 leading-snug">{req.bossComment}</p>
                  </div>
                )}
                {req.confirmedAt && (
                  <p className="text-xs text-text-quaternary mt-2">处理时间 {formatDateTime(req.confirmedAt)}</p>
                )}

                {/* 待处理的审批操作区 */}
                {isPending && (
                  <div className="mt-4 pt-3 border-t border-border-subtle">
                    {/* 批示输入 */}
                    <div className="mb-3">
                      <label className="text-xs text-text-quaternary mb-1 block">批示意见（可选）</label>
                      <input
                        type="text"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        placeholder="输入批示意见…"
                        className="input"
                        disabled={isDeciding}
                      />
                    </div>

                    {/* 操作按钮 —— 批准开除用 danger 实色，拒绝用 ghost */}
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDecide(req.id, true); }}
                        disabled={isDeciding}
                        className="flex-1 px-3 py-2 text-sm font-ui text-white rounded-md transition-colors-fast disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ backgroundColor: 'var(--color-danger)' }}
                      >
                        {isDeciding ? '处理中…' : '批准开除'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDecide(req.id, false); }}
                        disabled={isDeciding}
                        className="btn-ghost flex-1"
                      >
                        {isDeciding ? '处理中…' : '拒绝开除'}
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
        <div className="flex items-center justify-center gap-2 pt-3 border-t border-border-subtle">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-2 py-1 text-xs text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors-fast"
          >
            上一页
          </button>
          <span className="text-xs text-text-quaternary">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-2 py-1 text-xs text-text-tertiary hover:text-text-primary hover:bg-bg-hover rounded-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors-fast"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
