/**
 * ToolLoopRunner — 可复用的工具调用循环（P1-5 收敛版）
 *
 * 合并了原先两份重复抽象：
 *   - src/main/agents/tool-loop-runner.js（原版，agent-communication + 子模块用，非流式）
 *   - src/main/chat/tool-loop.js（chat-manager 用，流式 + 非流式）
 *
 * 现在统一为本模块一份 runToolLoop，同时满足两个调用方：
 *   - chat-manager（流式 + 非流式，对象式签名）
 *   - agent-communication 及其子模块（agent-messaging / task-delegation，非流式，位置式签名）
 *
 * 核心逻辑：调 LLM → 解析工具调用 → 执行工具 → 追加结果 → 循环，
 *   直到无工具调用或达到迭代上限。
 *
 * 差异点全部参数化，由调用方通过 deps/options 注入：
 *   - agent.chat / toolSchema / toolExecutor / toolRegistry
 *   - 上下文构建（getPermissionContext / getFilteredToolSchema）
 *   - 钩子：onBeforeLLMCall / onToolExecuted / onAgentSuspended / onStage / onStageChange
 *   - 流式控制：stream / webContents / getTurnReminder / token 用量记录
 *   - 迭代上限策略
 *
 * @module agents/tool-loop-runner
 */

const { logger } = require('../utils/logger');
const { agentConfigStore } = require('../config/agent-config-store');

// 流式相关依赖（仅在流式分支用到，延迟 require 以避免非流式调用方承担额外耦合）
// 这里在模块顶部 require 是安全的：stream-handler / token-estimator / context-fitter
// 都不反向依赖 tool-loop-runner，无循环依赖风险。
const {
  createStreamBuffer,
  sendStreamChunk,
  sendToolEvent,
} = require('../chat/stream-handler');
const {
  estimateTokens,
  estimateMessages,
  getAvailableBudget,
} = require('../llm/token-estimator');
const { compressToolHistory } = require('../chat/context-fitter');
const { isContextTooLongError } = require('../llm/llm-manager');

// 默认安全上限，允许复杂任务
const DEFAULT_MAX_ITERATIONS = 100;

// 检查是否为上下文超限错误（用于降级重试）
// 优先用 llm-manager 的权威实现；兜底本地实现（防 import 失败）
function _isContextTooLongError(err) {
  if (typeof isContextTooLongError === 'function') {
    try {
      return isContextTooLongError(err);
    } catch {
      /* fall through */
    }
  }
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();
  return (
    msg.includes('context_length_exceeded') ||
    msg.includes('maximum context length') ||
    msg.includes('context length') ||
    msg.includes('too long') ||
    msg.includes('token limit') ||
    msg.includes('context window')
  );
}

/**
 * 运行工具循环
 *
 * 支持两种调用风格：
 *  1) runToolLoop({ agent, message, history, context, options })  — 对象式（chat-manager 推荐）
 *  2) runToolLoop(agent, message, history, context, options)       — 位置式（agent-communication 原签名兼容）
 *
 * 对象式亦接受 `userMessage` 作为 `message` 的别名（chat-manager 沿用此命名）。
 *
 * @param {Object} params
 * @param {Object} params.agent - 目标 Agent 对象（需有 .chat / .id / .name / .role / .model / .systemPrompt）
 * @param {string} params.message - 初始消息内容（对象式亦可用 params.userMessage）
 * @param {Array<{role:string,content:string}>} params.history - 对话历史
 * @param {Object} [params.context={}] - 透传给工具执行器的上下文
 *   - context.messageId - 流式推送用的消息 ID（流式必需）
 *   - context.conversationId - 会话 ID（用于 sessionId 透传、上下文压缩）
 *   - context.attachments - 第一轮附件（非流式用 options.attachments 亦可）
 * @param {Object} [params.options]
 * @param {boolean} [params.options.stream=false] - 是否流式（chat-manager handleStreamMessage 需要）
 * @param {Electron.WebContents | null} [params.options.webContents=null] - 流式推送目标
 * @param {AbortSignal | null} [params.options.signal=null] - 取消信号
 * @param {number|Infinity} [params.options.maxIterations] - 迭代上限；不传则按 Agent 级别自动判定
 * @param {string} [params.options.toolSchema] - 工具 schema 文本（注入到消息中）
 * @param {Function} [params.options.getToolSchema] - 优先级高于 toolSchema
 *   - 非流式签名：(iteration, agent) => string（agent-communication 用）
 *   - 流式签名：(agentId) => string（chat-manager 用）
 *   本模块会自动适配两种签名：若函数 arity === 1 且参数是字符串/agentId，直接调用；
 *   否则按 (iteration, agent) 调用。
 * @param {Function} [params.options.getToolDefinitions] - 原生工具定义
 *   - 签名：(agent) => Object[] 或 (agentId) => Object[]
 * @param {Function} [params.options.getPermissionContext] - () => string；第一轮注入权限上下文
 * @param {Function} [params.options.getTurnReminder] - () => string；每轮行动提醒（流式 chat-manager 用）
 * @param {Function} [params.options.getNextMessage] - (toolCalls, toolResults, formattedResults, usedToolNames) => string；下一轮消息
 * @param {Function} [params.options.onBeforeLLMCall] - (iteration, nonStreamOptions) => void|{patchOptions}
 * @param {Function} [params.options.onLLMResponse] - (response, iteration) => void；每轮 LLM 返回后的通知
 * @param {Function} [params.options.onToolExecuted] - (toolCalls, toolResults, formattedResults) => void|{shouldBreak:boolean}
 *   （agent-communication 用于检测 submit_dev_plan 等触发中断的工具）
 * @param {Function} [params.options.onAgentSuspended] - (agent) => void|boolean；返回 true 表示已自行处理 finalContent
 * @param {Function} [params.options.onStage] - (agentId, stage) => void；阶段更新（chat-manager 用，签名与原 tool-loop.js 一致）
 * @param {Function} [params.options.onStageChange] - (stage) => void；工具执行阶段通知（agent-communication 用）
 * @param {Object} [params.options.toolExecutor] - 工具执行器；缺省则工具调用被跳过
 * @param {Object} [params.options.attachments] - 第一轮附件（非流式用）
 * @param {string} [params.options.turnReminder] - 注入到第一轮消息前的行动提醒（静态文本）
 * @param {string} [params.options.suspensionNotice] - 停职提示（替代工具 schema）
 * @param {boolean} [params.options.isInternalCommunication] - 是否内部通信（透传给 toolExecutor）
 * @param {Function} [params.options.compressHistory] - (currentHistory, budget, opts) => {compressed, wasCompressed}；可选上下文压缩
 * @param {Function} [params.options.estimateTokens] - (text) => number；配合 compressHistory
 * @param {Function} [params.options.getAvailableBudget] - (opts) => number；配合 compressHistory
 * @param {Function} [params.options.formatToolResults] - (results, opts) => string；覆盖 toolExecutor.formatToolResults
 * @param {Object} [params.options.activeTaskInfo] - 活跃任务信息（用于 stage 更新等）
 *
 * @returns {Promise<{content: string, toolsUsed: string[], iterations: number}>}
 *   - 非流式：content = 累计的最终内容
 *   - 流式：content = displayContent（已推送给前端的全部内容）
 */
async function runToolLoop(...args) {
  // 解析参数：对象式或位置式
  let agent, message, history, context, options;
  if (
    args.length === 1 &&
    args[0] &&
    typeof args[0] === 'object' &&
    args[0].agent
  ) {
    // 对象式：兼容 message / userMessage 两种命名
    const opts = args[0];
    message = opts.message !== undefined ? opts.message : opts.userMessage;
    ({ agent, history = [], context = {}, options = {} } = opts);
  } else {
    // 位置式：agent-communication 原签名
    [agent, message, history = [], context = {}, options = {}] = args;
  }

  const {
    stream = false,
    webContents = null,
    maxIterations,
    toolSchema: staticToolSchema,
    getToolSchema,
    getToolDefinitions,
    getPermissionContext,
    getTurnReminder,
    getNextMessage,
    onBeforeLLMCall,
    onLLMResponse,
    onToolExecuted,
    onAgentSuspended,
    onStage,
    onStageChange,
    toolExecutor,
    signal = null,
    attachments,
    turnReminder: staticTurnReminder = '',
    suspensionNotice = '',
    compressHistory: compressHistoryOverride,
    estimateTokens: estimateTokensOverride,
    getAvailableBudget: getAvailableBudgetOverride,
    formatToolResults: formatToolResultsOverride,
  } = options;

  // 延迟加载工具解析器（避免循环依赖）
  const {
    parseToolCalls,
    hasToolCalls,
    removeToolCalls,
  } = require('../tools/tool-executor');

  // 流式 / 非流式共用辅助
  const _estimateTokens =
    typeof estimateTokensOverride === 'function' ? estimateTokensOverride : estimateTokens;
  const _getAvailableBudget =
    typeof getAvailableBudgetOverride === 'function'
      ? getAvailableBudgetOverride
      : getAvailableBudget;
  const _compressHistory =
    typeof compressHistoryOverride === 'function'
      ? compressHistoryOverride
      : compressToolHistory;

  // 工具 schema 解析（适配两种签名）
  const resolveToolSchema = (iter) => {
    if (typeof getToolSchema === 'function') {
      // chat-manager 传 (agentId) => string；agent-communication 传 (iteration, agent) => string
      // 通过函数 length 判断（arity === 1 视为 chat-manager 风格）
      if (getToolSchema.length === 1) {
        return getToolSchema(agent.id) || '';
      }
      return getToolSchema(iter, agent) || '';
    }
    return staticToolSchema || '';
  };

  // getToolDefinitions 同样兼容两种签名
  const resolveToolDefinitions = () => {
    if (typeof getToolDefinitions !== 'function') return null;
    if (getToolDefinitions.length === 1) return getToolDefinitions(agent.id);
    return getToolDefinitions(agent);
  };

  // 行动提醒：优先 getTurnReminder()（每轮可变），其次静态 turnReminder
  const resolveTurnReminder = () => {
    if (typeof getTurnReminder === 'function') return getTurnReminder() || '';
    return staticTurnReminder;
  };

  let currentHistory = [...history];
  const reminder = resolveTurnReminder();
  let currentMessage = reminder ? `${reminder}\n\n${message}` : message;
  let finalContent = ''; // 非流式累计内容
  let displayContent = ''; // 流式累计内容
  let iteration = 0;
  let shouldBreak = false;

  // 本次调用中实际执行过的工具名称（局部变量，避免实例共享问题）
  const toolsUsedInThisCall = [];

  // 计算迭代上限
  let effectiveMaxIterations;
  if (typeof maxIterations === 'number' || maxIterations === Infinity) {
    effectiveMaxIterations = maxIterations;
  } else {
    // 默认策略：CXO 级别不限，其他 100
    const agentConfig = agentConfigStore.get(agent.id);
    const isCxoLevel =
      agentConfig?.level === 'c_level' ||
      ['ceo', 'cto', 'cfo', 'chro', 'secretary'].includes(agent.role);
    effectiveMaxIterations = isCxoLevel ? Infinity : DEFAULT_MAX_ITERATIONS;
  }

  // 第 4 层防御：检查 Agent 停职状态（决定第一轮是否注入停职提示）
  const suspendConfig = agentConfigStore.get(agent.id);
  const isSuspended =
    suspendConfig?.status === 'suspended' ||
    suspendConfig?.status === 'terminated';
  const effectiveSuspensionNotice =
    suspensionNotice ||
    (isSuspended
      ? `\n\n---\n\n【重要通知】你目前处于停职状态，所有工具权限已被冻结，无法与同事沟通。如需申诉，请直接与老板对话。\n停职原因：${suspendConfig?.suspendReason || '未说明'}`
      : '');

  const messageId = context.messageId;

  while (iteration < effectiveMaxIterations && !shouldBreak) {
    // 取消检查（循环顶部）
    if (signal?.aborted) {
      const abortTag = stream
        ? '\n\n_（任务已被终止）_'
        : '\n\n（操作已被用户取消）';
      if (stream) {
        sendStreamChunk(webContents, messageId, abortTag);
        displayContent += abortTag;
      } else {
        finalContent += abortTag;
      }
      logger.info(
        `ToolLoopRunner: ${agent.name || agent.id} ${stream ? '流式' : '非流式'}工具循环被取消`
      );
      break;
    }

    iteration++;

    // 阶段通知（第一轮 thinking，后续 responding）
    if (typeof onStage === 'function') {
      onStage(agent.id, iteration === 1 ? 'thinking' : 'responding');
    }

    // 构建本轮消息：第一轮注入权限上下文 + 工具 schema（或停职提示）
    let messageWithTools = currentMessage;
    const toolSchema = resolveToolSchema(iteration);

    if (effectiveSuspensionNotice && iteration === 1) {
      messageWithTools = `${currentMessage}${effectiveSuspensionNotice}`;
    } else if (toolSchema && iteration === 1) {
      const permContext =
        typeof getPermissionContext === 'function' ? getPermissionContext() : '';
      messageWithTools = `${currentMessage}\n\n---\n\n${permContext}\n\n【可用工具】\n${toolSchema}`;
    } else if (toolSchema && iteration > 1) {
      messageWithTools = `${currentMessage}\n\n---\n提醒：你仍然可以继续使用工具。请使用 <name>工具名</name><arguments><参数名>参数值</参数名></arguments> 格式。常用工具名：read_file、write_file、list_files、shell、git_branch、git_commit、git_create_pr、git_status。不要使用 fs_write、read_code、list_dir、execute_command 等错误名称。`;
    }

    // 构建调用选项
    const chatOptions = stream ? { stream: true, _streamUsage: {} } : { stream: false };
    const firstRoundAttachments =
      iteration === 1 && (context.attachments?.length > 0 || attachments?.length > 0);
    if (firstRoundAttachments) {
      chatOptions.attachments = context.attachments || attachments;
    }
    if (toolSchema) {
      const toolDefs = resolveToolDefinitions();
      if (toolDefs) chatOptions.tools = toolDefs;
    }

    // 调用前钩子（调用方可 patch chatOptions）
    if (typeof onBeforeLLMCall === 'function') {
      const patch = onBeforeLLMCall(iteration, chatOptions);
      if (patch && typeof patch === 'object') {
        Object.assign(chatOptions, patch);
      }
    }

    // 调用 Agent，含上下文超限降级重试
    let response;
    try {
      response = await agent.chat(messageWithTools, currentHistory, chatOptions);
    } catch (chatErr) {
      if (_isContextTooLongError(chatErr) && currentHistory.length > 0) {
        logger.warn(
          `ToolLoopRunner: ${agent.name || agent.id} 上下文超限，减半历史重试`,
          { historyLen: currentHistory.length, error: chatErr.message, stream }
        );
        const halvedHistory = currentHistory.slice(
          -Math.floor(currentHistory.length / 2)
        );
        try {
          response = await agent.chat(messageWithTools, halvedHistory, chatOptions);
          currentHistory = halvedHistory;
        } catch (retryErr) {
          if (_isContextTooLongError(retryErr)) {
            logger.warn(
              `ToolLoopRunner: ${agent.name || agent.id} 减半历史仍超限，无历史重试`
            );
            response = await agent.chat(messageWithTools, [], chatOptions);
            currentHistory = [];
          } else {
            throw retryErr;
          }
        }
      } else {
        throw chatErr;
      }
    }

    // 取消检查（LLM 返回后）
    if (signal?.aborted) {
      const abortTag = stream
        ? '\n\n_（任务已被终止）_'
        : '\n\n（操作已被用户取消）';
      if (stream) {
        sendStreamChunk(webContents, messageId, abortTag);
        displayContent += abortTag;
      } else {
        finalContent += abortTag;
      }
      logger.info(
        `ToolLoopRunner: ${agent.name || agent.id} 工具循环被取消（LLM 返回后）`
      );
      break;
    }

    // ─── 流式 / 非流式分叉 ────────────────────────────────────
    let roundContent;
    if (stream) {
      // 流式：response 是 async iterable，边消费边推送
      roundContent = await _consumeStream({
        response,
        signal,
        webContents,
        messageId,
        agent,
        iteration,
        chatOptions,
        currentHistory,
        messageWithTools,
        onDisplay: (chunk) => {
          displayContent += chunk;
        },
      });

      // 响应通知钩子（流式：传入完整 roundContent）
      if (typeof onLLMResponse === 'function') {
        onLLMResponse(roundContent, iteration);
      }

      // 第 2 层防御：停职 Agent 即使生成了工具调用也跳过解析
      const streamRuntimeConfig = agentConfigStore.get(agent.id);
      const streamRuntimeStatus = streamRuntimeConfig?.status || 'active';
      if (streamRuntimeStatus === 'suspended' || streamRuntimeStatus === 'terminated') {
        if (typeof onAgentSuspended === 'function') {
          const handled = onAgentSuspended(agent);
          if (handled === true) break;
        }
        break; // 流式内容已推送，直接结束
      }

      if (!hasToolCalls(roundContent)) {
        break; // 流式已推送完毕，无需再设 finalContent
      }
    } else {
      // 非流式：response 是最终字符串
      roundContent = response;

      // 响应通知钩子
      if (typeof onLLMResponse === 'function') {
        onLLMResponse(response, iteration);
      }

      // 第 2 层防御：停职 Agent 即使生成了工具调用也跳过解析
      const runtimeConfig = agentConfigStore.get(agent.id);
      const runtimeStatus = runtimeConfig?.status || 'active';
      if (runtimeStatus === 'suspended' || runtimeStatus === 'terminated') {
        if (typeof onAgentSuspended === 'function') {
          const handled = onAgentSuspended(agent);
          if (handled === true) {
            // 调用方自行处理 finalContent
            break;
          }
        }
        finalContent = removeToolCalls(roundContent) || roundContent;
        break;
      }

      // 没有工具调用 → 最终内容
      if (!hasToolCalls(roundContent)) {
        finalContent = roundContent;
        break;
      }
    }

    logger.info(
      `ToolLoopRunner: ${agent.id} 第 ${iteration} 轮工具调用`,
      { stream }
    );

    // 阶段通知（进入工具执行）
    if (typeof onStage === 'function') {
      onStage(agent.id, 'tools');
    }
    if (typeof onStageChange === 'function') {
      onStageChange('tools');
    }

    // 解析工具调用
    const toolCalls = parseToolCalls(roundContent);
    const textContent = removeToolCalls(roundContent);

    // 工具调用前的文本说明
    // 非流式：累计到 finalContent；流式：已经通过 buffer 实时推送过文本部分
    if (!stream && textContent && textContent.trim()) {
      finalContent += textContent.trim() + '\n\n';
    }

    // 执行工具
    if (!toolExecutor || toolCalls.length === 0) {
      if (!stream) finalContent = roundContent;
      break;
    }

    // 流式：为工具调用生成 id + 推送 tool-group 标记 + tool_start 事件
    let toolCallsWithId = toolCalls;
    if (stream) {
      const toolGroupIndex = iteration - 1;
      toolCallsWithId = toolCalls.map((t, i) => ({
        ...t,
        id: `tc-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      }));

      const toolMarker = `\n\n<!--tool-group:${toolGroupIndex}-->\n\n`;
      sendStreamChunk(webContents, messageId, toolMarker);
      displayContent += toolMarker;

      sendToolEvent(webContents, messageId, {
        type: 'tool_start',
        groupIndex: toolGroupIndex,
        tools: toolCallsWithId.map((t) => ({
          id: t.id,
          name: t.name,
          args: t.arguments || {},
        })),
      });

      // 工具执行前再次检查中止
      if (signal?.aborted) {
        const abortTag = '\n\n_（任务已被终止，工具未执行）_';
        sendStreamChunk(webContents, messageId, abortTag);
        displayContent += abortTag;
        break;
      }
    }

    // 构建工具执行上下文
    const execCtx = {
      agentId: agent.id,
      agentName: agent.name,
      ...context,
    };
    // 流式：传入 onProgress 回调，把工具进度事件实时推送给前端
    const onProgress = stream
      ? (progressEvent) => {
          sendToolEvent(webContents, messageId, progressEvent);
        }
      : undefined;

    const toolResults = await toolExecutor.executeToolCalls(
      toolCallsWithId,
      execCtx,
      onProgress
    );

    // 格式化结果（允许调用方覆盖，比如 chat-manager 传 sessionId）
    const fmtFn =
      typeof formatToolResultsOverride === 'function'
        ? formatToolResultsOverride
        : toolExecutor.formatToolResults.bind(toolExecutor);
    const fmtOpts = context.conversationId ? { sessionId: context.conversationId } : {};
    const formattedResults = fmtFn(toolResults, fmtOpts);

    // 更新历史
    currentHistory = [
      ...currentHistory,
      { role: 'assistant', content: roundContent },
      { role: 'user', content: `工具执行结果：\n\n${formattedResults}` },
    ];

    // 记录已使用的工具（局部变量）
    const usedToolNames = toolCalls.map((t) => t.name).join(', ');
    for (const tc of toolCalls) {
      if (!toolsUsedInThisCall.includes(tc.name)) {
        toolsUsedInThisCall.push(tc.name);
      }
    }

    // 工具执行后钩子（用于检测 submit_dev_plan 等触发中断的工具）
    if (typeof onToolExecuted === 'function') {
      const cb = onToolExecuted(toolCalls, toolResults, formattedResults);
      if (cb?.shouldBreak) {
        finalContent += formattedResults;
        shouldBreak = true;
      }
    }

    // 上下文压缩（每轮工具执行后）
    if (
      shouldBreak === false &&
      typeof _compressHistory === 'function' &&
      typeof _estimateTokens === 'function' &&
      typeof _getAvailableBudget === 'function'
    ) {
      try {
        const toolBudget = _getAvailableBudget({
          model: agent.model,
          systemPromptTokens: _estimateTokens(agent.systemPrompt || ''),
          userMessageTokens: _estimateTokens(currentMessage),
        });
        const { compressed, wasCompressed } = _compressHistory(currentHistory, toolBudget, {
          sessionId: context.conversationId,
          taskContext: message?.slice(0, 100),
        });
        if (wasCompressed) {
          currentHistory = compressed;
          logger.info(
            `ToolLoopRunner: ${agent.name || agent.id} 第 ${iteration} 轮上下文已压缩`
          );
        }
      } catch (compressErr) {
        logger.debug('ToolLoopRunner: 上下文压缩失败（不影响循环）:', compressErr.message);
      }
    }

    // 计算下一轮消息
    if (shouldBreak === false) {
      if (typeof getNextMessage === 'function') {
        currentMessage = getNextMessage(
          toolCalls,
          toolResults,
          formattedResults,
          usedToolNames
        );
      } else {
        // 默认下一轮提示（流式与非流式文案略有差异）
        currentMessage = stream
          ? '【系统指令】工具已执行完毕。请直接基于工具返回的结果回答用户问题。禁止：1)重复问候语 2)重复之前说过的话 3)再次调用工具。直接输出答案内容。'
          : `【系统指令】工具已执行完毕。请根据工具返回的结果完成任务。

规则：
1. 如果结果已经足够，直接给出最终答案
2. 如果需要继续使用工具，必须使用不同的工具或不同的参数
3. 禁止重复调用刚才已执行的工具：${usedToolNames}
4. 不要重复问候语或解释

直接输出你的处理结论或下一步操作。`;
      }
    }

    logger.info(`ToolLoopRunner: 工具执行完成`, {
      agent: agent.id,
      tools: toolCalls.map((t) => t.name),
      iteration,
      resultsLength: formattedResults.length,
    });
  }

  // 达到迭代上限的兜底
  if (!signal?.aborted && iteration >= effectiveMaxIterations && !shouldBreak) {
    logger.warn(`ToolLoopRunner: ${agent.id} 达到最大工具调用轮数`, {
      iteration,
      maxIterations: effectiveMaxIterations,
    });
    const maxMsg = '\n\n（已达到最大工具调用次数）';
    if (stream) {
      sendStreamChunk(webContents, messageId, maxMsg);
      displayContent += maxMsg;
    } else {
      finalContent += maxMsg;
      if (!finalContent.trim()) {
        finalContent = '（任务处理中，请稍后查看结果）';
      }
    }
  }

  return {
    content: stream ? displayContent : finalContent,
    toolsUsed: toolsUsedInThisCall,
    iterations: iteration,
  };
}

/**
 * 消费流式生成器，实时推送给前端，记录 token 用量
 * 返回完整 roundContent（含工具调用）
 */
async function _consumeStream({
  response,
  signal,
  webContents,
  messageId,
  agent,
  iteration,
  chatOptions,
  currentHistory,
  messageWithTools,
  onDisplay,
}) {
  let roundContent = '';
  const streamBuffer = createStreamBuffer();
  let chunkCount = 0;
  let aborted = false;

  for await (const chunk of response) {
    if (signal?.aborted) {
      aborted = true;
      break;
    }
    chunkCount++;
    roundContent += chunk;
    const { toSend } = streamBuffer.process(chunk);
    if (chunkCount <= 5) {
      logger.debug(`ToolLoopRunner: 流式块 ${chunkCount}`, {
        chunkLen: chunk.length,
        toSendLen: toSend?.length || 0,
      });
    }
    if (toSend) {
      sendStreamChunk(webContents, messageId, toSend);
      onDisplay?.(toSend);
    }
  }

  if (aborted) {
    // 不在这里推送中止消息（由外层统一处理），但丢弃 buffer 残余
    streamBuffer.flush();
    return roundContent;
  }

  // 记录 token 用量（SSE 精确值 > 估算兜底）
  const su = chatOptions._streamUsage;
  let recordedPrompt = su?.promptTokens || 0;
  let recordedCompletion = su?.completionTokens || 0;
  let tokenSource = 'sse';

  if (recordedPrompt === 0) {
    const messagesForEstimate = [
      { role: 'system', content: agent.systemPrompt || '' },
      ...currentHistory,
      { role: 'user', content: messageWithTools || '' },
    ];
    recordedPrompt = estimateMessages(messagesForEstimate);
    tokenSource = recordedCompletion === 0 ? 'estimated' : 'sse+estimated';
  }
  if (recordedCompletion === 0) {
    recordedCompletion = estimateTokens(roundContent);
    tokenSource = recordedPrompt === 0 ? 'estimated' : 'sse+estimated';
  }

  if (recordedPrompt > 0 || recordedCompletion > 0) {
    const totalTokens = recordedPrompt + recordedCompletion;
    try {
      const { tokenTracker } = require('../budget/token-tracker');
      tokenTracker.record({
        agentId: agent.id,
        model: su?.model || agent.model || 'unknown',
        promptTokens: recordedPrompt,
        completionTokens: recordedCompletion,
        conversationId: messageId, // 用 messageId 作 conversationId 兜底，外层会覆盖
      });
    } catch (e) {
      logger.debug('tokenTracker 记录失败（不影响对话）:', e.message);
    }
    logger.info(`ToolLoopRunner: ${agent.name || agent.id} token 用量 (${tokenSource})`, {
      promptTokens: recordedPrompt,
      completionTokens: recordedCompletion,
      total: totalTokens,
    });

    // 从工资余额中扣除 token
    try {
      const { budgetManager } = require('../budget/budget-manager');
      const deductResult = budgetManager.deductTokens(agent.id, totalTokens);
      if (deductResult.success) {
        logger.debug(
          `ToolLoopRunner: ${agent.name || agent.id} 扣除 ${totalTokens} tokens，余额: ${deductResult.newBalance}`
        );
      }
    } catch (e) {
      logger.debug('budget 扣除失败（不影响对话）:', e.message);
    }
  }
  // 重置 _streamUsage 供下一轮使用
  chatOptions._streamUsage = {};

  logger.info(`ToolLoopRunner: ${agent.name || agent.id} 流式完成`, {
    totalChunks: chunkCount,
    roundContentLen: roundContent.length,
  });

  // 刷新缓冲区剩余内容
  const remaining = streamBuffer.flush();
  if (remaining) {
    sendStreamChunk(webContents, messageId, remaining);
    onDisplay?.(remaining);
  }

  return roundContent;
}

module.exports = {
  runToolLoop,
  DEFAULT_MAX_ITERATIONS,
};
