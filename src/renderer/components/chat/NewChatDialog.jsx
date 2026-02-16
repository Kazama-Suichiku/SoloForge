/**
 * SoloForge - 创建群聊弹窗
 * 选择多个 Agent 创建群聊
 * @module components/chat/NewChatDialog
 */

import { useState, useCallback, useMemo } from 'react';
import { useAgentStore } from '../../store/agent-store';
import { useChatStore } from '../../store/chat-store';
import AgentAvatar from '../AgentAvatar';

/**
 * 创建群聊弹窗
 */
export default function NewChatDialog({ isOpen, onClose }) {
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      <div className="relative bg-bg-base rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
          <h3 className="text-lg font-semibold text-text-primary">创建群聊</h3>
          <button type="button" onClick={handleClose} className="text-text-secondary hover:text-text-primary">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Agent 列表 */}
        <div className="px-4 py-4 max-h-80 overflow-auto">
          <p className="text-sm text-text-secondary mb-3">选择要加入群聊的成员</p>
          <div className="space-y-2">
            {agents.map((agent) => {
              const isSelected = selectedAgents.includes(agent.id);
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => toggleAgent(agent.id)}
                  className={`w-full flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors ${
                    isSelected
                      ? 'bg-[var(--color-primary)]/15 ring-1 ring-[var(--color-primary)]'
                      : 'hover:bg-[var(--border-color)]/50'
                  }`}
                >
                  <AgentAvatar avatar={agent.avatar} fallback="🤖" size="md" />
                  <div className="flex-1">
                    <p className="font-medium text-text-primary">{agent.name}</p>
                    <p className="text-xs text-text-secondary">{agent.title || agent.description}</p>
                  </div>
                  <div
                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      isSelected
                        ? 'bg-[var(--color-primary)] border-[var(--color-primary)]'
                        : 'border-[var(--border-color)]'
                    }`}
                  >
                    {isSelected && (
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 群聊名称 + 创建按钮 */}
        {selectedAgents.length > 0 && (
          <div className="px-4 pb-4 space-y-3">
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="群聊名称（可选）"
              className="w-full rounded-xl border border-[var(--border-color)] bg-bg-elevated px-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/50"
            />
            <button
              type="button"
              onClick={handleCreate}
              className="w-full py-3 rounded-xl font-medium bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary)]/90 transition-colors"
            >
              创建群聊 ({selectedAgents.length} 人)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
