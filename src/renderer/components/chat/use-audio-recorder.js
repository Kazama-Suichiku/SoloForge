/**
 * SoloForge - 语音录制 Hook（从 ChatInput.jsx 拆分）
 *
 * 职责：管理 AudioContext + PCM 录制 + WAV 编码 + 保存/转写 IPC。
 * 使用 AudioContext 直接录制 WAV（PCM 格式），避免 webm/opus 格式
 * 不被 macOS SFSpeechRecognizer 支持的问题。
 *
 * @module components/chat/use-audio-recorder
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 将 PCM Float32 样本数组编码为 WAV 文件的 Uint8Array
 * @param {Float32Array[]} chunks - PCM 样本块
 * @param {number} sampleRate - 采样率
 * @returns {Uint8Array} WAV 文件数据
 */
function encodeWAV(chunks, sampleRate) {
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
}

/**
 * 格式化录音时间（mm:ss）
 */
export function formatRecordingTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * 语音录制 Hook
 * @param {(transcribedText: string, audioAttachment: object) => void} onTranscribed
 *        录音完成并转写后回调，传入转写文本和音频附件对象
 * @returns {{ isRecording, isTranscribing, recordingTime, toggleRecording, stopRecording }}
 */
export function useAudioRecorder(onTranscribed) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);

  const audioChunksRef = useRef([]); // PCM Float32 样本块
  const recordingTimerRef = useRef(null);
  const recordingTimeRef = useRef(0); // 保存录音时长（避免 setState 异步）

  const audioContextRef = useRef(null);
  const audioSourceRef = useRef(null);
  const audioProcessorRef = useRef(null);
  const audioStreamRef = useRef(null);

  // onTranscribed 引用：用 ref 包裹，避免回调变化导致 startRecording/stopRecording 依赖变化
  const onTranscribedRef = useRef(onTranscribed);
  useEffect(() => {
    onTranscribedRef.current = onTranscribed;
  }, [onTranscribed]);

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

        onTranscribedRef.current?.(transcribedText, audioAttachment);
      } catch (err) {
        console.error('处理语音消息失败:', err);
      } finally {
        setIsTranscribing(false);
      }
    })();
  }, []);

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

  return { isRecording, isTranscribing, recordingTime, toggleRecording, stopRecording };
}
