/**
 * SoloForge - 聊天输入框组件
 * 支持多行输入、Enter 发送、Shift+Enter 换行、@mention、图片粘贴/拖拽/选择、语音输入
 * @module components/chat/ChatInput
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useChatStore } from '../../store/chat-store';
import { useAgentStore } from '../../store/agent-store';
import AgentAvatar from '../AgentAvatar';

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
  const [attachments, setAttachments] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const textareaRef = useRef(null);
  const audioChunksRef = useRef([]); // PCM Float32 样本块
  const recordingTimerRef = useRef(null);
  const recordingTimeRef = useRef(0); // 保存录音时长
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

  // 过滤后的 Agent 列表
  const filteredAgents = useMemo(() => {
    if (!mentionFilter) return availableAgents;
    const lower = mentionFilter.toLowerCase();
    return availableAgents.filter(
      (a) => a.id.toLowerCase().includes(lower) || a.name.toLowerCase().includes(lower)
    );
  }, [availableAgents, mentionFilter]);

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
  }, [currentConversationId]);

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

  // ─────────────────────────────────────────────────────────
  // 图片附件处理
  // ─────────────────────────────────────────────────────────

  /**
   * 处理添加图片文件（通用逻辑：从 File 对象保存为附件）
   */
  const addImageFiles = useCallback(async (files) => {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const arrayBuffer = await file.arrayBuffer();
        // 用 Uint8Array 包装，比原始 ArrayBuffer 在 IPC 序列化中更可靠
        const uint8Array = new Uint8Array(arrayBuffer);
        const result = await window.soloforge.attachment.save({
          buffer: uint8Array,
          mimeType: file.type,
          filename: file.name,
        });
        if (result?.success && result.attachment) {
          setAttachments((prev) => [...prev, result.attachment]);
        } else if (result?.error) {
          console.error('添加图片失败:', result.error);
        }
      } catch (err) {
        console.error('添加图片失败:', err);
      }
    }
  }, []);

  /**
   * 粘贴处理：检测剪贴板中的图片
   */
  const handlePaste = useCallback(
    (e) => {
      // 仅当 Agent 支持多模态时才处理图片粘贴
      if (!supportsImageInput) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles = [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        addImageFiles(imageFiles);
        // 粘贴图片后立即确保 textarea 保持焦点和可编辑状态
        // （Electron 中 IPC 调用可能导致焦点瞬移）
        requestAnimationFrame(() => {
          textareaRef.current?.focus();
        });
      }
    },
    [addImageFiles, supportsImageInput]
  );

  /**
   * 拖拽处理
   */
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith('image/')
      );
      if (files.length > 0) {
        addImageFiles(files);
      }
    },
    [addImageFiles]
  );

  /**
   * 文件选择对话框
   */
  const handleSelectImages = useCallback(async () => {
    try {
      const result = await window.soloforge.attachment.selectImages();
      if (result?.attachments?.length > 0) {
        setAttachments((prev) => [...prev, ...result.attachments]);
      }
    } catch (err) {
      console.error('选择图片失败:', err);
    }
  }, []);

  /**
   * 移除待发送的图片
   */
  const removeAttachment = useCallback((attachmentId) => {
    setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
  }, []);

  // ─────────────────────────────────────────────────────────
  // 语音消息处理（微信/QQ 风格）
  // 使用 AudioContext 直接录制 WAV（PCM 格式）
  // 避免 webm/opus 格式不被 macOS SFSpeechRecognizer 支持的问题
  // ─────────────────────────────────────────────────────────

  const audioContextRef = useRef(null);
  const audioSourceRef = useRef(null);
  const audioProcessorRef = useRef(null);
  const audioStreamRef = useRef(null);

  /**
   * 将 PCM Float32 样本数组编码为 WAV 文件的 Uint8Array
   * @param {Float32Array[]} chunks - PCM 样本块
   * @param {number} sampleRate - 采样率
   * @returns {Uint8Array} WAV 文件数据
   */
  const encodeWAV = useCallback((chunks, sampleRate) => {
    // 合并所有 chunk
    let totalLength = 0;
    for (const chunk of chunks) totalLength += chunk.length;
    const pcmData = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      pcmData.set(chunk, offset);
      offset += chunk.length;
    }

    // 转换为 16-bit PCM
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataLength = pcmData.length * bytesPerSample;
    const headerLength = 44;
    const buffer = new ArrayBuffer(headerLength + dataLength);
    const view = new DataView(buffer);

    // WAV 文件头
    const writeString = (offset, str) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true);  // PCM format
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);

    // 写入 PCM 数据（Float32 → Int16）
    let writeOffset = 44;
    for (let i = 0; i < pcmData.length; i++) {
      const sample = Math.max(-1, Math.min(1, pcmData[i]));
      view.setInt16(writeOffset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      writeOffset += 2;
    }

    return new Uint8Array(buffer);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });

      // 使用 AudioContext 捕获原始 PCM（输出 WAV，macOS 原生兼容）
      const audioContext = new AudioContext({ sampleRate: 16000 });
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      audioChunksRef.current = [];

      processor.onaudioprocess = (e) => {
        const channelData = e.inputBuffer.getChannelData(0);
        // 复制一份（因为原始 buffer 会被复用）
        audioChunksRef.current.push(new Float32Array(channelData));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      audioContextRef.current = audioContext;
      audioSourceRef.current = source;
      audioProcessorRef.current = processor;
      audioStreamRef.current = stream;

      setIsRecording(true);
      setRecordingTime(0);
      recordingTimeRef.current = 0;

      // 开始计时
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          recordingTimeRef.current = prev + 1;
          return prev + 1;
        });
      }, 1000);
    } catch (err) {
      console.error('启动录音失败:', err);
    }
  }, []);

  const stopRecording = useCallback(() => {
    // 停止音频处理
    if (audioProcessorRef.current) {
      audioProcessorRef.current.disconnect();
      audioProcessorRef.current = null;
    }
    if (audioSourceRef.current) {
      audioSourceRef.current.disconnect();
      audioSourceRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
    }

    const sampleRate = audioContextRef.current?.sampleRate || 16000;

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setIsRecording(false);
    setRecordingTime(0);

    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    // 编码 WAV 并发送
    const chunks = audioChunksRef.current;
    if (!chunks || chunks.length === 0) return;

    const duration = recordingTimeRef.current;
    const wavData = encodeWAV(chunks, sampleRate);

    if (wavData.length <= 44) return; // 只有文件头，没有实际音频

    // 异步处理：保存 + 转写 + 发送
    setIsTranscribing(true);
    (async () => {
      try {
        const [saveResult, sttResult] = await Promise.all([
          window.soloforge.attachment.save({
            buffer: wavData,
            mimeType: 'audio/wav',
            filename: `语音消息_${new Date().toLocaleTimeString('zh-CN')}.wav`,
          }),
          window.soloforge.stt.transcribe(wavData),
        ]);

        if (!saveResult?.success || !saveResult.attachment) {
          console.error('保存语音文件失败:', saveResult?.error);
          return;
        }

        const audioAttachment = {
          ...saveResult.attachment,
          duration,
          transcription: sttResult?.success ? sttResult.text : '',
        };

        const transcribedText = sttResult?.success && sttResult.text
          ? sttResult.text
          : '[语音消息 - 识别失败]';

        onSend(transcribedText, [audioAttachment]);
      } catch (err) {
        console.error('处理语音消息失败:', err);
      } finally {
        setIsTranscribing(false);
      }
    })();
  }, [encodeWAV, onSend]);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  // 组件卸载时清理录音
  useEffect(() => {
    return () => {
      if (audioProcessorRef.current) audioProcessorRef.current.disconnect();
      if (audioSourceRef.current) audioSourceRef.current.disconnect();
      if (audioStreamRef.current) audioStreamRef.current.getTracks().forEach((t) => t.stop());
      if (audioContextRef.current) audioContextRef.current.close();
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, []);

  // ─────────────────────────────────────────────────────────
  // @mention 和发送处理
  // ─────────────────────────────────────────────────────────

  // 检测 @ 输入
  const handleContentChange = useCallback((e) => {
    const value = e.target.value;
    setContent(value);

    // 检测是否正在输入 @mention（支持中文名匹配）
    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@([\w\u4e00-\u9fff]*)$/);

    if (atMatch) {
      setShowMentionMenu(true);
      setMentionFilter(atMatch[1]);
      setMentionIndex(0);
    } else {
      setShowMentionMenu(false);
      setMentionFilter('');
    }
  }, []);

  // 插入 @mention
  const insertMention = useCallback((agent) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = content.slice(0, cursorPos);
    const textAfterCursor = content.slice(cursorPos);

    // 找到 @ 的位置
    const atIndex = textBeforeCursor.lastIndexOf('@');
    if (atIndex === -1) return;

    // 替换 @xxx 为 @人名（对用户更友好）
    const displayName = agent.name || agent.id;
    const newText = textBeforeCursor.slice(0, atIndex) + `@${displayName} ` + textAfterCursor;
    setContent(newText);
    setShowMentionMenu(false);
    setMentionFilter('');

    // 聚焦并设置光标位置
    setTimeout(() => {
      textarea.focus();
      const newPos = atIndex + displayName.length + 2;
      textarea.setSelectionRange(newPos, newPos);
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
  }, [content, attachments, disabled, onSend]);

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

  // 格式化录音时间
  const formatRecordingTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

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
          >
            停止
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
