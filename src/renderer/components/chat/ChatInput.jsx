/**
 * SoloForge - 聊天输入框组件
 * 支持多行输入、Enter 发送、Shift+Enter 换行、@mention、图片粘贴/拖拽/选择、语音输入
 *
 * 职责拆分（Phase 1 批次 4b）：
 *   - 语音录制 → use-audio-recorder.js（AudioContext + WAV 编码 + STT）
 *   - 拖拽/粘贴/选择图片附件 → use-drop-zone.js
 *   - @mention 字符串操作 → mention-helper.js（纯函数）
 *   - 本文件只保留：核心输入框状态、@mention 状态编排、群聊"肃静"、JSX UI 组合
 *
 * @module components/chat/ChatInput
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useChatStore } from '../../store/chat-store';
import { useAgentStore } from '../../store/agent-store';
import AgentAvatar from '../AgentAvatar';
import { useAudioRecorder, formatRecordingTime } from './use-audio-recorder';
import { useDropZone } from './use-drop-zone';
import { detectMention, buildMentionInsert, filterAgents } from './mention-helper';

/**
 * 聊天输入框
 * @param {Object} props
 * @param {(content: string, attachments?: Array) => void} props.onSend - 发送消息回调
 * @param {boolean} [props.disabled] - 是否禁用
 * @param {string} [props.placeholder] - 占位文字
 */
export default function ChatInput({
  onSend,
  onSilenceGroup,
  disabled = false,
  placeholder = '输入消息...',
}) {
  const [content, setContent] = useState('');
  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef(null);
  const currentConversationId = useChatStore((s) => s.currentConversationId);
  const conversations = useChatStore((s) => s.conversations);
  const agentsMap = useAgentStore((s) => s.agents);

  // 获取当前对话中的 Agent 列表
  const availableAgents = useMemo(() => {
    const conv = conversations.get(currentConversationId);
    if (!conv) return [];
    return conv.participants
      .filter((p) => p !== 'user')
      .map((id) => agentsMap.get(id))
      .filter(Boolean);
  }, [conversations, currentConversationId, agentsMap]);

  // 当前对话是否有 Agent 支持图片输入（多模态）
  const isAgentMultimodal = useAgentStore((s) => s.isAgentMultimodal);
  const supportsImageInput = useMemo(() => {
    // 只要对话中有任意一个 Agent 支持多模态，就允许图片输入
    return availableAgents.some((agent) => isAgentMultimodal(agent.id));
  }, [availableAgents, isAgentMultimodal]);

  // 过滤后的 Agent 列表（使用 mention-helper 纯函数）
  const filteredAgents = useMemo(
    () => filterAgents(availableAgents, mentionFilter),
    [availableAgents, mentionFilter]
  );

  // 语音录制 hook：录音停止后会调用 onTranscribed(transcribedText, audioAttachment)，
  // 在这里桥接到 ChatInput 的 onSend(content, attachments) 接口（与原实现行为一致）。
  const onTranscribed = useCallback(
    (transcribedText, audioAttachment) => {
      onSend?.(transcribedText, [audioAttachment]);
    },
    [onSend]
  );
  const {
    isRecording,
    recordingTime,
    isTranscribing,
    toggleRecording,
    stopRecording,
  } = useAudioRecorder(onTranscribed);

  // 图片附件管理 hook（粘贴/拖拽/选择/移除）
  const {
    attachments,
    setAttachments,
    removeAttachment,
    handlePaste: dropZoneHandlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleSelectImages,
    isDragOver,
  } = useDropZone(supportsImageInput);

  // 自动调整高度
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
    }
  }, [content]);

  // 切换对话时清空输入
  useEffect(() => {
    setContent('');
    setShowMentionMenu(false);
    setAttachments([]);
  }, [currentConversationId, setAttachments]);

  // 附件变化后自动聚焦输入框（确保粘贴/拖拽/选择图片后仍可输入文字）
  // 使用 useEffect 保证在 React DOM 更新完毕后执行，比 setTimeout 更可靠
  const prevAttachmentCountRef = useRef(0);
  useEffect(() => {
    if (attachments.length > prevAttachmentCountRef.current) {
      // 新增了附件，聚焦输入框
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
    prevAttachmentCountRef.current = attachments.length;
  }, [attachments.length]);

  // 粘贴处理：在 dropZoneHandlePaste 基础上补充聚焦逻辑
  // （use-drop-zone.js 不持有 textareaRef，故由调用方在此处理焦点恢复）
  const handlePaste = useCallback(
    (e) => {
      const hadImageBefore = attachments.length;
      dropZoneHandlePaste(e);
      // 若粘贴了图片（附件数增加），立即确保 textarea 保持焦点和可编辑状态
      // （Electron 中 IPC 调用可能导致焦点瞬移）
      if (attachments.length > hadImageBefore) {
        requestAnimationFrame(() => {
          textareaRef.current?.focus();
        });
      }
    },
    [dropZoneHandlePaste, attachments.length]
  );

  // ─────────────────────────────────────────────────────────
  // @mention 和发送处理
  // ─────────────────────────────────────────────────────────

  // 检测 @ 输入（使用 mention-helper 纯函数）
  const handleContentChange = useCallback((e) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    setContent(value);

    const { active, filter } = detectMention(value, cursorPos);
    if (active) {
      setShowMentionMenu(true);
      setMentionFilter(filter);
      setMentionIndex(0);
    } else {
      setShowMentionMenu(false);
      setMentionFilter('');
    }
  }, []);

  // 插入 @mention（使用 mention-helper 纯函数构建新文本 + 光标位置）
  const insertMention = useCallback((agent) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const result = buildMentionInsert(content, cursorPos, agent);
    if (!result) return;

    const { text: newText, newCursorPos } = result;
    setContent(newText);
    setShowMentionMenu(false);
    setMentionFilter('');

    // 聚焦并设置光标位置
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  }, [content]);

  const handleSend = useCallback(() => {
    const trimmed = content.trim();
    const hasAttachments = attachments.length > 0;
    if ((!trimmed && !hasAttachments) || disabled) return;

    onSend(trimmed, hasAttachments ? attachments : undefined);
    setContent('');
    setAttachments([]);

    // 重置高度
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [content, attachments, disabled, onSend, setAttachments]);

  const handleKeyDown = useCallback(
    (e) => {
      // 检测是否在输入法组合状态（中文/日文等输入法正在输入时）
      // isComposing 为 true 时，用户正在使用输入法选字，不应该触发发送
      if (e.nativeEvent?.isComposing || e.isComposing) {
        return;
      }

      // 如果 mention 菜单打开，处理导航
      if (showMentionMenu && filteredAgents.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setMentionIndex((i) => (i + 1) % filteredAgents.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setMentionIndex((i) => (i - 1 + filteredAgents.length) % filteredAgents.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          insertMention(filteredAgents[mentionIndex]);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowMentionMenu(false);
          return;
        }
      }

      // Enter 发送，Shift+Enter 换行
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, showMentionMenu, filteredAgents, mentionIndex, insertMention]
  );

  const canSend = (content.trim().length > 0 || attachments.length > 0) && !disabled;

  // 判断当前对话是否为群聊
  const currentConversation = conversations.get(currentConversationId);
  const isGroupChat = currentConversation?.type === 'group';

  // "肃静！" 按钮处理
  const handleSilence = useCallback(() => {
    if (!currentConversationId || !onSilenceGroup) return;
    onSilenceGroup(currentConversationId);
  }, [currentConversationId, onSilenceGroup]);

  return (
    <div
      className={`shrink-0 px-6 py-4 border-t border-[var(--border-color)] bg-bg-base transition-colors ${
        isDragOver ? 'ring-2 ring-[var(--color-primary)]/50 bg-[var(--color-primary)]/5' : ''
      }`}
      onDragOver={supportsImageInput ? handleDragOver : undefined}
      onDragLeave={supportsImageInput ? handleDragLeave : undefined}
      onDrop={supportsImageInput ? handleDrop : undefined}
    >
      {/* 拖拽提示覆盖层 */}
      {supportsImageInput && isDragOver && (
        <div className="flex items-center justify-center py-4 mb-3 border-2 border-dashed border-[var(--color-primary)]/50 rounded-xl bg-[var(--color-primary)]/5">
          <div className="flex items-center gap-2 text-[var(--color-primary)]">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span className="text-sm font-medium">释放以添加图片</span>
          </div>
        </div>
      )}

      {/* 图片预览区 */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="relative group w-20 h-20 rounded-xl overflow-hidden border border-[var(--border-color)] bg-bg-elevated"
            >
              <img
                src={`sf-local://${att.path}`}
                alt={att.filename}
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => removeAttachment(att.id)}
                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/80"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <div className="absolute bottom-0 inset-x-0 bg-black/40 px-1 py-0.5 text-[10px] text-white truncate">
                {att.filename}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 录音中状态 */}
      {isRecording && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2.5 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
          </span>
          <span className="text-sm text-red-600 dark:text-red-400 font-medium">
            录音中 {formatRecordingTime(recordingTime)}
          </span>
          <button
            type="button"
            onClick={stopRecording}
            className="ml-auto text-xs px-2.5 py-1 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
          >停止
          </button>
        </div>
      )}

      {/* 转写中状态 */}
      {isTranscribing && (
        <div className="flex items-center gap-2 mb-3 px-4 py-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-xl">
          <svg className="w-4 h-4 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
          <span className="text-sm text-blue-600 dark:text-blue-400">语音识别中...</span>
        </div>
      )}

      <div className="flex items-end gap-3">
        {/* 图片选择按钮（仅当 Agent 支持多模态时显示） */}
        {supportsImageInput && (
        <button
          type="button"
          onClick={handleSelectImages}
          disabled={disabled || !currentConversationId}
          className="shrink-0 w-9 h-9 mb-0.5 rounded-lg flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-[var(--border-color)]/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="添加图片"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>
        )}

        {/* 输入框 */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleContentChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            disabled={disabled || !currentConversationId}
            rows={1}
            className="w-full resize-none rounded-2xl border border-[var(--border-color)] bg-bg-elevated px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/50 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ minHeight: '44px', maxHeight: '150px' }}
          />

          {/* @mention 菜单 */}
          {showMentionMenu && filteredAgents.length > 0 && (
            <div className="absolute bottom-full left-0 mb-2 w-64 bg-bg-elevated border border-[var(--border-color)] rounded-xl shadow-lg overflow-hidden">
              <div className="px-3 py-2 text-xs text-text-secondary border-b border-[var(--border-color)]">
                选择要 @ 的成员
              </div>
              {filteredAgents.map((agent, idx) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => insertMention(agent)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                    idx === mentionIndex
                      ? 'bg-[var(--color-primary)]/15'
                      : 'hover:bg-[var(--border-color)]/30'
                  }`}
                >
                  <AgentAvatar avatar={agent.avatar} fallback="🤖" size="xs" />
                  <div>
                    <p className="text-sm font-medium text-text-primary">{agent.name}</p>
                    <p className="text-xs text-text-secondary">@{agent.id}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 群聊"肃静！"按钮 */}
        {isGroupChat && (
          <button
            type="button"
            onClick={handleSilence}
            className="shrink-0 h-11 px-3 rounded-xl flex items-center justify-center gap-1.5 transition-all text-sm font-bold border-2 border-red-500/50 text-red-400 hover:bg-red-500/15 hover:border-red-500 hover:text-red-300 active:scale-95"
            title="停止群聊中所有人发言"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
            </svg>
            肃静！
          </button>
        )}

        {/* 语音输入按钮 */}
        <button
          type="button"
          onClick={toggleRecording}
          disabled={disabled || !currentConversationId || isTranscribing}
          className={`shrink-0 w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
            isRecording
              ? 'bg-red-500 text-white hover:bg-red-600 animate-pulse'
              : 'bg-[var(--border-color)]/50 text-text-secondary hover:text-text-primary hover:bg-[var(--border-color)]'
          } disabled:opacity-40 disabled:cursor-not-allowed`}
          title={isRecording ? '停止录音' : '语音输入'}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {isRecording ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
            ) : (
              <>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </>
            )}
          </svg>
        </button>

        {/* 发送按钮 */}
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className={`shrink-0 w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
            canSend
              ? 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary)]/90'
              : 'bg-[var(--border-color)] text-text-secondary cursor-not-allowed'
          }`}
          title="发送 (Enter)"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
            />
          </svg>
        </button>
      </div>

      {/* 提示文字 */}
      <p className="text-xs text-text-secondary mt-2 text-center">
        Enter 发送，Shift + Enter 换行，@ 提及成员{supportsImageInput ? '，可粘贴/拖拽图片' : ''}
      </p>
    </div>
  );
}
