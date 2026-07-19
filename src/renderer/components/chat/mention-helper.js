/**
 * SoloForge - @mention 辅助逻辑（从 ChatInput.jsx 拆分）
 *
 * 纯函数：检测光标前是否正在输入 @mention，以及插入 @ 人名后的文本与光标位置。
 * 支持中文名匹配（\u4e00-\u9fff）。
 *
 * @module components/chat/mention-helper
 */

/**
 * 检测文本中光标位置之前是否正在输入 @mention
 * @param {string} value - textarea 当前值
 * @param {number} cursorPos - 光标位置（selectionStart）
 * @returns {{ active: boolean, filter: string }}
 *   active 为 true 时应打开 mention 菜单，filter 为 @ 后已输入的过滤词
 */
export function detectMention(value, cursorPos) {
  const textBeforeCursor = value.slice(0, cursorPos);
  const atMatch = textBeforeCursor.match(/@([\w\u4e00-\u9fff]*)$/);
  if (atMatch) {
    return { active: true, filter: atMatch[1] };
  }
  return { active: false, filter: '' };
}

/**
 * 计算 @mention 插入后的新文本与新光标位置（不直接操作 DOM）
 * @param {string} content - textarea 当前值
 * @param {number} cursorPos - 光标位置
 * @param {{ id: string, name?: string }} agent - 要 @ 的 agent
 * @returns {{ text: string, newCursorPos: number } | null}
 *   找不到 @ 时返回 null
 */
export function buildMentionInsert(content, cursorPos, agent) {
  const textBeforeCursor = content.slice(0, cursorPos);
  const textAfterCursor = content.slice(cursorPos);

  // 找到 @ 的位置
  const atIndex = textBeforeCursor.lastIndexOf('@');
  if (atIndex === -1) return null;

  // 替换 @xxx 为 @人名（对用户更友好）
  const displayName = agent.name || agent.id;
  const newText = textBeforeCursor.slice(0, atIndex) + `@${displayName} ` + textAfterCursor;
  const newCursorPos = atIndex + displayName.length + 2;
  return { text: newText, newCursorPos };
}

/**
 * 过滤 agent 列表（按 mentionFilter）
 * @param {Array<{id: string, name: string}>} agents
 * @param {string} filter
 * @returns {Array} 过滤后的 agent 列表
 */
export function filterAgents(agents, filter) {
  if (!filter) return agents;
  const lower = filter.toLowerCase();
  return agents.filter(
    (a) => a.id.toLowerCase().includes(lower) || a.name.toLowerCase().includes(lower)
  );
}
