/**
 * SoloForge - macOS 语音识别 CLI 工具
 * 使用 SFSpeechRecognizer 进行本地离线语音识别
 *
 * 用法: ./macos-stt <audio-file-path>
 * 输出: 识别的文本到 stdout
 *
 * 编译: swiftc -O -o macos-stt macos-stt.swift -framework Speech -framework Foundation
 *
 * 要求: macOS 10.15+, Speech 框架权限
 */

import Foundation
import Speech

// 检查命令行参数
guard CommandLine.arguments.count > 1 else {
    fputs("用法: macos-stt <audio-file-path>\n", stderr)
    exit(1)
}

let audioPath = CommandLine.arguments[1]
let audioURL = URL(fileURLWithPath: audioPath)

// 验证文件存在
guard FileManager.default.fileExists(atPath: audioPath) else {
    fputs("错误: 文件不存在 - \(audioPath)\n", stderr)
    exit(1)
}

// 创建信号量用于等待异步结果
let semaphore = DispatchSemaphore(value: 0)
var recognizedText: String?
var recognitionError: String?

// 请求语音识别权限
SFSpeechRecognizer.requestAuthorization { status in
    guard status == .authorized else {
        recognitionError = "语音识别权限未授权。请在系统设置 > 隐私与安全性 > 语音识别中授予权限。"
        semaphore.signal()
        return
    }

    // 创建识别器（中文简体）
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN")),
          recognizer.isAvailable else {
        // 降级到默认语言
        guard let fallbackRecognizer = SFSpeechRecognizer(),
              fallbackRecognizer.isAvailable else {
            recognitionError = "语音识别服务不可用"
            semaphore.signal()
            return
        }

        // 使用默认识别器
        performRecognition(recognizer: fallbackRecognizer, url: audioURL) { text, error in
            recognizedText = text
            recognitionError = error
            semaphore.signal()
        }
        return
    }

    // 尝试使用 on-device 识别（macOS 13+）
    if #available(macOS 13, *) {
        recognizer.supportsOnDeviceRecognition = true
    }

    performRecognition(recognizer: recognizer, url: audioURL) { text, error in
        recognizedText = text
        recognitionError = error
        semaphore.signal()
    }
}

func performRecognition(recognizer: SFSpeechRecognizer, url: URL, completion: @escaping (String?, String?) -> Void) {
    let request = SFSpeechURLRecognitionRequest(url: url)
    request.shouldReportPartialResults = false

    // macOS 13+ 支持 on-device
    if #available(macOS 13, *) {
        request.requiresOnDeviceRecognition = false // 允许在线降级
    }

    recognizer.recognitionTask(with: request) { result, error in
        if let error = error {
            completion(nil, "识别错误: \(error.localizedDescription)")
            return
        }

        guard let result = result else {
            completion(nil, "未返回识别结果")
            return
        }

        if result.isFinal {
            let text = result.bestTranscription.formattedString
            completion(text.isEmpty ? nil : text, text.isEmpty ? "未能识别任何语音内容" : nil)
        }
    }
}

// 等待结果（最多 30 秒）
let timeout = semaphore.wait(timeout: .now() + 30)

if timeout == .timedOut {
    fputs("错误: 语音识别超时\n", stderr)
    exit(1)
}

if let error = recognitionError {
    fputs("错误: \(error)\n", stderr)
    exit(1)
}

if let text = recognizedText {
    print(text)
    exit(0)
} else {
    fputs("错误: 未能识别任何语音内容\n", stderr)
    exit(1)
}
