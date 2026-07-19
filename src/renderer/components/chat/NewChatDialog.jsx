/**
 * SoloForge - 创建群聊弹窗（Linear 风格重构）
 * 选择多个 Agent 创建群聊
 * @module components/chat/NewChatDialog
 *
 * 设计:
 *  - 弹窗用 var(--bg-surface) 背景 + 多层阴影
 *  - 输入框 .input 风格（半透明背景 + 细边框）
 *  - Agent 选择列表紧凑
 *  - 选中态用 accent 半透明背景 + accent 边框
 * 全部使用新 Linear 设计 Token（CSS 变量）。
 */

import { useState, useCallback, useMemo, memo } from 'react';
import { useAgentStore } from '../../store/agent-store';
import { useChatStore } from '../../store/chat-store';
import AgentAvatar from '../AgentAvatar';

/**
 * Agent 选择项（memo 优化）
 */
const AgentSelectItem = memo(function AgentSelectItem({ agent, isSelected, onToggle }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(agent.id)}
      className="w-full flex items-center gap-2.5 text-left transition-colors emil-pressable"
      style={{
        borderRadius: 'var(--radius-md, 6px)',
        padding: '8px 10px',
        background: isSelected
          ? 'rgba(94,106,210,0.12)'
          : 'transparent',
        border: isSelected
          ? '1px solid rgba(94,106,210,0.4)'
          : '1px solid transparent',
      }}
      onMouseEnter={(e) => {
        if (!isSelected) {
          e.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.04))';
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          e.currentTarget.style.background = 'transparent';
        }
      }}
    >
      <AgentAvatar avatar={agent.avatar} fallback="🤖" size="sm" />
      <div className="flex-1 min-w-0">
        <p
          className="text-[13px] font-medium truncate"
          style={{ color: 'var(--text-primary, #f7f8f8)' }}
        >
          {agent.name}
        </p>
        <p
          className="text-[11px] truncate"
          style={{ color: 'var(--text-tertiary, #8a8f98)' }}
        >
          {agent.title || agent.description || ''}
        </p>
      </div>
      <div
        className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 transition-colors"
        style={{
          background: isSelected ? 'var(--accent, #5e6ad2)' : 'transparent',
          border: isSelected
            ? '1px solid var(--accent, #5e6ad2)'
            : '1px solid var(--border-default, rgba(255,255,255,0.08))',
        }}
      >
        {isSelected && (
          <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
    </button>
  );
});

/**
 * 创建群聊弹窗
 */
function NewChatDialog({ isOpen, onClose }) {
  const agentsMap = useAgentStore((s) => s.agents);
  const createGroupChat = useChatStore((s) => s.createGroupChat);

  const agents = useMemo(
    () => Array.from(agentsMap.values()).filter((a) => a.agentStatus !== 'terminated'),
    [agentsMap]
  );

  const [selectedAgents, setSelectedAgents] = useState([]);
  const [groupName, setGroupName] = useState('');

  const toggleAgent = useCallback((agentId) => {
    setSelectedAgents((prev) =>
      prev.includes(agentId)
        ? prev.filter((id) => id !== agentId)
        : [...prev, agentId]
    );
  }, []);

  const handleCreate = useCallback(() => {
    if (selectedAgents.length === 0) return;
    const name = groupName.trim() || `群聊 (${selectedAgents.length + 1}人)`;
    createGroupChat({ name, participants: selectedAgents });
    setSelectedAgents([]);
    setGroupName('');
    onClose();
  }, [selectedAgents, groupName, createGroupChat, onClose]);

  const handleClose = useCallback(() => {
    setSelectedAgents([]);
    setGroupName('');
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      handleClose();
    }
  }, [handleClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onKeyDown={handleKeyDown}
    >
      {/* 遮罩 */}
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.5)' }}
        onClick={handleClose}
      />

      {/* 弹窗主体：液态玻璃 + emil-pill-enter 入场 */}
      <div
        className="relative w-full max-w-md mx-4 overflow-hidden surface glass-enter emil-pill-enter"
        style={{
          borderRadius: 'var(--radius-xl, 12px)',
          boxShadow:
            'var(--shadow-dialog, 0 24px 48px -12px rgba(0,0,0,0.5), 0 8px 16px -4px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.04))',
        }}
      >
        {/* 头部 */}
        <div
          className="flex items-center justify-between px-5 h-12"
          style={{ borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.05))' }}
        >
          <h3
            className="text-[14px] font-medium"
            style={{ color: 'var(--text-primary, #f7f8f8)' }}
          >
            创建群聊
          </h3>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 rounded-md transition-colors"
            style={{ color: 'var(--text-tertiary, #8a8f98)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.04))';
              e.currentTarget.style.color = 'var(--text-primary, #f7f8f8)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-tertiary, #8a8f98)';
            }}
            title="关闭 (Esc)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Agent 列表 */}
        <div className="px-3 py-3 max-h-80 overflow-auto">
          <p
            className="text-[12px] mb-2 px-2"
            style={{ color: 'var(--text-tertiary, #8a8f98)' }}
          >
            选择要加入群聊的成员
          </p>
          <div className="space-y-0.5">
            {agents.length === 0 ? (
              <p
                className="text-[12px] py-4 text-center"
                style={{ color: 'var(--text-tertiary, #8a8f98)' }}
              >
                暂无可用 Agent
              </p>
            ) : (
              agents.map((agent) => (
                <AgentSelectItem
                  key={agent.id}
                  agent={agent}
                  isSelected={selectedAgents.includes(agent.id)}
                  onToggle={toggleAgent}
                />
              ))
            )}
          </div>
        </div>

        {/* 群聊名称 + 创建按钮 */}
        {selectedAgents.length > 0 && (
          <div
            className="px-3 pb-3 space-y-2"
            style={{ borderTop: '1px solid var(--border-subtle, rgba(255,255,255,0.05))' }}
          >
            <div className="pt-3 space-y-2">
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="群聊名称（可选）"
                className="w-full text-[13px] focus:outline-none transition-colors"
                style={{
                  borderRadius: 'var(--radius-md, 6px)',
                  border: '1px solid var(--border-default, rgba(255,255,255,0.08))',
                  background: 'rgba(255,255,255,0.03)',
                  padding: '8px 12px',
                  color: 'var(--text-primary, #f7f8f8)',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--accent, #5e6ad2)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-default, rgba(255,255,255,0.08))';
                }}
              />
              <button
                type="button"
                onClick={handleCreate}
                className="w-full text-[13px] font-medium text-white transition-colors"
                style={{
                  borderRadius: 'var(--radius-md, 6px)',
                  padding: '10px 0',
                  background: 'var(--accent, #5e6ad2)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--accent-hover, #7170ff)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--accent, #5e6ad2)';
                }}
              >
                创建群聊 ({selectedAgents.length} 人)
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(NewChatDialog);
