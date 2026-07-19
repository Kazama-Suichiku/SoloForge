import { useState, useCallback } from 'react';
import { UserPlusIcon, UserIcon, ChatBubbleLeftIcon } from '@heroicons/react/24/outline';
import { STATUS_COLORS, STATUS_LABELS, PAGE_SIZE } from './constants';
import { formatDate } from './utils';
import { ChevronIcon, DetailField, EmptyState, Pagination } from './ui';

/**
 * 招聘审批列表
 * props: { requests: Array, onRefresh: Function }
 */
export default function RecruitmentList({ requests, onRefresh }) {
  const [expandedId, setExpandedId] = useState(null);
  const [page, setPage] = useState(1);
  const [isClearing, setIsClearing] = useState(false);

  // 统计已处理的数量
  const processedCount = requests.filter(
    (r) => r.status !== 'pending' && r.status !== 'discussing'
  ).length;

  const handleClearProcessed = useCallback(async () => {
    if (!window.confirm('确定要清空所有已处理的招聘记录吗？（待审批和讨论中的不会被清空）')) return;
    setIsClearing(true);
    try {
      const result = await window.electronAPI.clearProcessedRecruits?.();
      if (result?.success) {
        setPage(1);
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

  if (!requests.length) {
    return <EmptyState icon={UserPlusIcon} message="暂无招聘申请" />;
  }

  const totalPages = Math.ceil(requests.length / PAGE_SIZE);
  const display = requests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      {/* 清空按钮 */}
      {processedCount > 0 && (
        <div className="flex justify-end mb-2">
          <button
            onClick={handleClearProcessed}
            disabled={isClearing}
            className="px-2 py-1 text-xs text-purple-500 hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded transition-colors disabled:opacity-50"
          >
            {isClearing ? '清空中...' : `清空已处理 (${processedCount})`}
          </button>
        </div>
      )}
      <div className="space-y-1">
        {display.map((req) => {
          const isExpanded = expandedId === req.id;
          return (
            <div
              key={req.id}
              className={`rounded-lg transition-colors ${
                isExpanded
                  ? 'bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800'
                  : 'hover:bg-[var(--bg-hover)] border border-transparent'
              }`}
            >
              <button
                type="button"
                className="w-full flex items-center gap-3 p-2.5 text-left"
                onClick={() => setExpandedId(isExpanded ? null : req.id)}
              >
                <ChevronIcon expanded={isExpanded} />
                <div className="w-7 h-7 rounded-full bg-bg-muted flex items-center justify-center shrink-0">
                  <UserIcon className="w-3.5 h-3.5 text-text-muted" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">
                    {req.candidateName || '(未命名)'}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {req.candidateTitle} · 申请人: {req.requester}
                  </p>
                </div>
                <span className={`px-2 py-0.5 text-xs rounded-full shrink-0 ${STATUS_COLORS[req.status] || STATUS_COLORS.pending}`}>
                  {STATUS_LABELS[req.status] || req.status}
                </span>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-color)]/50 ml-9">
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    <DetailField label="部门" value={req.department} />
                    <DetailField label="申请人" value={req.requester} />
                    <DetailField label="申请时间" value={formatDate(req.createdAt)} />
                    {req.reviewedAt && <DetailField label="审批时间" value={formatDate(req.reviewedAt)} />}
                    {req.reviewedBy && <DetailField label="审批人" value={req.reviewedBy} />}
                    {req.revisionCount > 0 && (
                      <div>
                        <span className="text-xs text-text-muted">简历修订</span>
                        <p className="text-sm text-text-primary mt-0.5">{req.revisionCount} 次</p>
                      </div>
                    )}
                  </div>

                  {req.discussionCount > 0 && (
                    <div className="mt-3 p-2 bg-bg-muted rounded-lg flex items-center gap-2">
                      <ChatBubbleLeftIcon className="w-4 h-4 text-text-muted shrink-0" />
                      <span className="text-xs text-text-secondary">
                        {req.discussionCount} 轮面试讨论
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Pagination current={page} total={totalPages} onChange={setPage} itemCount={requests.length} />
    </div>
  );
}
