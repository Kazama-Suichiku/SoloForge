/**
 * SoloForge - 拖拽/粘贴/选择图片附件 Hook（从 ChatInput.jsx 拆分）
 *
 * 职责：管理图片附件的添加（粘贴、拖拽、文件选择对话框）与移除。
 * 附件保存走 window.soloforge.attachment IPC，与原实现完全一致。
 *
 * @module components/chat/use-drop-zone
 */

import { useCallback, useState } from 'react';

/**
 * 图片附件管理 Hook
 * @param {boolean} enabled - 是否启用图片输入（Agent 支持多模态时为 true）
 * @returns {{
 *   attachments, addImageFiles, addImageAttachments, removeAttachment,
 *   setAttachments, handlePaste, handleDragOver, handleDragLeave, handleDrop, handleSelectImages,
 *   isDragOver, setIsDragOver
 * }}
 */
export function useDropZone(enabled) {
  const [attachments, setAttachments] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);

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
   * 直接添加已有的附件对象（如从文件选择对话框返回的 attachments 数组）
   */
  const addImageAttachments = useCallback((newAttachments) => {
    if (!newAttachments?.length) return;
    setAttachments((prev) => [...prev, ...newAttachments]);
  }, []);

  /**
   * 粘贴处理：检测剪贴板中的图片
   */
  const handlePaste = useCallback(
    (e) => {
      // 仅当 Agent 支持多模态时才处理图片粘贴
      if (!enabled) return;

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
          // 注意：textarea ref 由调用方持有；这里不直接聚焦，
          // 调用方可在粘贴回调中自行处理聚焦。
        });
      }
    },
    [addImageFiles, enabled]
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

  return {
    attachments,
    setAttachments,
    addImageFiles,
    addImageAttachments,
    removeAttachment,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleSelectImages,
    isDragOver,
    setIsDragOver,
  };
}
