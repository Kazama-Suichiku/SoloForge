/**
 * SoloForge - 通用 Agent 头像组件
 * 支持 emoji 和图片头像，方形圆角展示；可选在线状态圆点。
 * Linear 风格：半透明背景 + 细边框。
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
  xs: { container: 'w-6 h-6', text: 'text-sm', rounded: 'rounded-md', dot: 'w-2 h-2', ring: 'ring-2' },
  sm: { container: 'w-10 h-10', text: 'text-lg', rounded: 'rounded-lg', dot: 'w-2.5 h-2.5', ring: 'ring-2' },
  md: { container: 'w-10 h-10', text: 'text-lg', rounded: 'rounded-lg', dot: 'w-2.5 h-2.5', ring: 'ring-2' },
  lg: { container: 'w-12 h-12', text: 'text-2xl', rounded: 'rounded-xl', dot: 'w-3 h-3', ring: 'ring-2' },
  xl: { container: 'w-14 h-14', text: 'text-2xl', rounded: 'rounded-xl', dot: 'w-3 h-3', ring: 'ring-2' },
  '2xl': { container: 'w-16 h-16', text: 'text-3xl', rounded: 'rounded-2xl', dot: 'w-3.5 h-3.5', ring: 'ring-[3px]' },
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
 * @param {boolean} [props.online] - 在线状态：true=在线（绿点）/false=离线（灰点）/undefined=不显示
 */
export default function AgentAvatar({
  avatar,
  fallback = '🤖',
  size = 'sm',
  bgClass = '',
  bgStyle,
  className = '',
  online,
}) {
  const [imgError, setImgError] = useState(false);

  const sizeConfig = SIZE_MAP[size] || SIZE_MAP.sm;
  const isImage = avatar && isImageAvatar(avatar) && !imgError;
  const displayEmoji = avatar && !isImageAvatar(avatar) ? avatar : fallback;
  const showDot = online !== undefined;

  const dotColor = online ? 'var(--color-success)' : 'var(--text-quaternary)';

  if (isImage) {
    return (
      <div
        className={`relative ${sizeConfig.container} ${sizeConfig.rounded} overflow-hidden shrink-0 ${className}`}
        style={bgStyle}
      >
        <img
          src={`sf-local://${avatar}`}
          alt="avatar"
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
          draggable={false}
        />
        {showDot && (
          <span
            className={`absolute bottom-0 right-0 ${sizeConfig.dot} rounded-full ${sizeConfig.ring}`}
            style={{
              backgroundColor: dotColor,
              // ring 颜色用容器底色，保证圆点与头像分离
              boxShadow: '0 0 0 2px var(--bg-base)',
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className={`relative ${sizeConfig.container} ${sizeConfig.rounded} flex items-center justify-center ${sizeConfig.text} shrink-0 ${
        bgClass || 'bg-white/[0.02] border border-border-default'
      } ${className}`}
      style={bgStyle}
    >
      {displayEmoji}
      {showDot && (
        <span
          className={`absolute bottom-0 right-0 ${sizeConfig.dot} rounded-full`}
          style={{
            backgroundColor: dotColor,
            boxShadow: '0 0 0 2px var(--bg-base)',
          }}
        />
      )}
    </div>
  );
}

export { isImageAvatar };
