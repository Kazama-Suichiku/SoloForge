/**
 * SoloForge - 通用 Agent 头像组件
 * 支持 emoji 和图片头像，方形圆角展示
 * @module components/AgentAvatar
 */

import { useState } from 'react';

/**
 * 判断 avatar 值是否为图片路径（而非 emoji）
 * @param {string} avatar
 * @returns {boolean}
 */
function isImageAvatar(avatar) {
  if (!avatar || avatar.length <= 2) return false;
  // 明确的图片路径标识
  if (avatar.startsWith('/') || avatar.startsWith('\\')) return true;
  if (/\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(avatar)) return true;
  // 包含路径分隔符
  if (avatar.includes('/') || avatar.includes('\\')) return true;
  return false;
}

// 预设尺寸配置
const SIZE_MAP = {
  xs: { container: 'w-6 h-6', text: 'text-sm', rounded: 'rounded-md' },
  sm: { container: 'w-9 h-9', text: 'text-lg', rounded: 'rounded-lg' },
  md: { container: 'w-10 h-10', text: 'text-lg', rounded: 'rounded-lg' },
  lg: { container: 'w-12 h-12', text: 'text-2xl', rounded: 'rounded-xl' },
  xl: { container: 'w-14 h-14', text: 'text-2xl', rounded: 'rounded-xl' },
  '2xl': { container: 'w-16 h-16', text: 'text-3xl', rounded: 'rounded-2xl' },
};

/**
 * Agent 头像组件
 *
 * @param {Object} props
 * @param {string} [props.avatar] - 头像内容（emoji 字符串 或 图片路径）
 * @param {string} [props.fallback='🤖'] - 没有 avatar 时的回退 emoji
 * @param {'xs'|'sm'|'md'|'lg'|'xl'|'2xl'} [props.size='sm'] - 预设尺寸
 * @param {string} [props.bgClass] - 自定义背景 class（覆盖默认）
 * @param {Object} [props.bgStyle] - 自定义背景 style
 * @param {string} [props.className] - 额外的容器 class
 */
export default function AgentAvatar({
  avatar,
  fallback = '🤖',
  size = 'sm',
  bgClass = '',
  bgStyle,
  className = '',
}) {
  const [imgError, setImgError] = useState(false);

  const sizeConfig = SIZE_MAP[size] || SIZE_MAP.sm;
  const isImage = avatar && isImageAvatar(avatar) && !imgError;
  const displayEmoji = avatar && !isImageAvatar(avatar) ? avatar : fallback;

  if (isImage) {
    return (
      <div
        className={`${sizeConfig.container} ${sizeConfig.rounded} overflow-hidden shrink-0 ${className}`}
        style={bgStyle}
      >
        <img
          src={`sf-local://${avatar}`}
          alt="avatar"
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
          draggable={false}
        />
      </div>
    );
  }

  return (
    <div
      className={`${sizeConfig.container} ${sizeConfig.rounded} flex items-center justify-center ${sizeConfig.text} shrink-0 ${
        bgClass || 'bg-bg-elevated border border-[var(--border-color)]'
      } ${className}`}
      style={bgStyle}
    >
      {displayEmoji}
    </div>
  );
}

export { isImageAvatar };
