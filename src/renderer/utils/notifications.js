/**
 * SoloForge - 桌面通知工具
 *
 * 封装 Electron / Web Notification API，统一处理权限请求与通知派发。
 * 渲染进程中 `new Notification(...)` 会被 Electron 自动代理为原生桌面通知
 * （主进程默认监听并调用系统 Notification API，无需额外 IPC 通道）。
 *
 * 使用场景：
 *   - Agent 主动推送消息（审批通知、工作汇报）
 *   - 部门群聊新消息（窗口失焦时提醒）
 *   - 未读消息累计触达
 *
 * @module utils/notifications
 */

/**
 * 检查 Notification API 是否可用（渲染进程环境）。
 * @returns {boolean}
 */
export function isNotificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * 查询当前通知权限状态。
 * @returns {'granted' | 'denied' | 'default' | 'unsupported'}
 */
export function getNotificationPermission() {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission;
}

/**
 * 请求通知权限（幂等：已授予/拒绝时直接 resolve 当前状态）。
 * @returns {Promise<'granted' | 'denied' | 'default' | 'unsupported'>}
 */
export async function requestNotificationPermission() {
  if (!isNotificationSupported()) return 'unsupported';
  try {
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    return await Notification.requestPermission();
  } catch (err) {
    console.warn('[notifications] requestPermission 失败:', err);
    return 'denied';
  }
}

/**
 * 判断当前窗口是否处于前台（有焦点）。
 * 用于决定是否需要发桌面通知：失焦时才打扰用户。
 * @returns {boolean}
 */
export function isWindowFocused() {
  if (typeof document === 'undefined') return true;
  return document.hasFocus();
}

/**
 * 判断当前窗口是否隐藏（最小化或切到其他 tab）。
 * Electron 中 `document.hidden` 在窗口最小化或失去焦点且不可见时为 true。
 * @returns {boolean}
 */
export function isWindowHidden() {
  if (typeof document === 'undefined') return false;
  return document.hidden;
}

/**
 * 发送一条桌面通知。
 *
 * - 权限未授予时自动请求一次；请求成功则递归发送。
 * - 权限被拒绝时静默降级（不打断用户）。
 * - 支持点击回调（用于聚焦窗口 + 切到对应会话）。
 *
 * @param {Object} params
 * @param {string} params.title - 通知标题
 * @param {string} [params.body=''] - 通知正文
 * @param {string} [params.icon] - 通知图标 URL（可选）
 * @param {boolean} [params.silent=false] - 是否静默（不播放系统提示音）
 * @param {() => void} [params.onClick] - 点击通知回调
 * @param {() => void} [params.onClose] - 通知关闭回调
 * @returns {Notification | null} 已发送的 Notification 实例（失败/无权限返回 null）
 *
 * @example
 * showNotification({
 *   title: 'CEO 张三',
 *   body: '老板，本季度营收增长 15%...',
 *   onClick: () => { focusWindow(); selectConversation('private-ceo'); },
 * });
 */
export async function showNotification({ title, body = '', icon, silent = false, onClick, onClose }) {
  if (!title) return null;
  if (!isNotificationSupported()) {
    // 非 Electron / 不支持 Notification：静默降级
    return null;
  }

  let permission = Notification.permission;

  // 权限未决定时先请求
  if (permission === 'default') {
    permission = await requestNotificationPermission();
  }

  if (permission !== 'granted') {
    // 权限被拒绝或请求失败：静默降级，不打断用户
    return null;
  }

  try {
    const n = new Notification(title, {
      body,
      ...(icon ? { icon } : {}),
      silent,
    });

    if (typeof onClick === 'function') {
      n.onclick = () => {
        // 点击通知后聚焦当前窗口
        try {
          if (typeof window !== 'undefined') {
            window.focus();
          }
        } catch { /* ignore */ }
        onClick();
      };
    }

    if (typeof onClose === 'function') {
      n.onclose = onClose;
    }

    // 自动关闭（避免通知堆积，Electron 桌面通知默认不自动消失）
    setTimeout(() => {
      try { n.close(); } catch { /* 已关闭 */ }
    }, 8000);

    return n;
  } catch (err) {
    console.warn('[notifications] showNotification 失败:', err);
    return null;
  }
}

/**
 * 便捷方法：仅在窗口失焦或隐藏时发送桌面通知。
 * 用于「收到新消息但用户没在看」的场景，避免打扰正在使用的用户。
 *
 * @param {Object} params - 同 showNotification
 * @returns {Promise<Notification | null>}
 */
export async function notifyIfBackground({ title, body, icon, silent, onClick, onClose }) {
  // 用户正在看窗口 → 不打扰
  if (isWindowFocused() && !isWindowHidden()) return null;
  return showNotification({ title, body, icon, silent, onClick, onClose });
}

export default {
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  isWindowFocused,
  isWindowHidden,
  showNotification,
  notifyIfBackground,
};
