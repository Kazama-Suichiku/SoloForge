import { memo, useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import DOMPurify from 'dompurify';

// P0 安全修复（审计报告维度 14）：
// 1. securityLevel: 'strict' —— mermaid 10+ 默认即为 'strict'，此处显式声明以防未来版本变更；
//    strict 模式下 mermaid 不会执行任意 JS，label 中的 click 交互被禁用，
//    输出为纯 SVG（不含 <script>、不含 on* 事件属性）。
// 2. 双重防御：渲染前用 DOMPurify 对 SVG 做 sanitize，白名单保留 mermaid 需要的标签/属性，
//    即使 mermaid 库未来引入 XSS 路径，这里仍能兜底。
// 3. dangerouslySetInnerHTML 只接收 sanitize 后的字符串，不再直接信任 mermaid 输出。
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict', // 禁止 mermaid 执行任意 JS（click 交互、内联 script 均被禁用）
  theme: 'dark',
  themeVariables: {
    primaryColor: '#5e6ad2',
    primaryTextColor: '#f4f4f5',
    primaryBorderColor: '#5e6ad2',
    lineColor: 'rgba(255,255,255,0.2)',
    secondaryColor: 'rgba(255,255,255,0.06)',
    tertiaryColor: 'rgba(255,255,255,0.03)',
    background: 'transparent',
    mainBkg: 'rgba(255,255,255,0.04)',
    secondBkg: 'rgba(255,255,255,0.08)',
    textColor: '#f4f4f5',
    fontSize: '14px',
  },
  flowchart: { curve: 'basis', htmlLabels: true },
  sequence: { actorMargin: 50, boxMargin: 10 },
  gantt: { barHeight: 20, fontSize: 12 },
  pie: { textPosition: 0.6 },
});

// DOMPurify 配置：白名单保留 mermaid SVG 输出需要的结构。
// mermaid 输出主要是 <svg> + <style> + <g>/<path>/<text>/<rect> 等形状元素，
// 以及内联 style 属性（用于主题着色）。保留这些；剥离所有事件属性与 <script>。
const PURIFY_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_TAGS: ['style'], // mermaid 生成内联 <style> 块用于主题样式
  ADD_ATTR: [
    // mermaid 输出常见的结构性属性
    'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
    'width', 'height', 'viewBox', 'preserveAspectRatio', 'transform',
    'points', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray',
    'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-size', 'font-weight',
    'font-family', 'text-anchor', 'text-decoration', 'class', 'style',
    'marker-end', 'marker-start', 'marker-mid', 'id', 'refX', 'refY',
    'markerWidth', 'markerHeight', 'orient', 'pathLength', 'clip-path',
    'gradientUnits', 'gradientTransform', 'offset', 'stop-color', 'stop-opacity',
    'patternUnits', 'patternTransform', 'xmlns', 'xmlns:xlink', 'xlink:href',
  ],
  // 显式禁止所有 on* 事件属性与 <script>（DOMPurify 默认已禁止，这里显式声明以防误配）
  FORBID_TAGS: ['script', 'foreignObject'],
  FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onmouseover', 'onmouseenter'],
};

function sanitizeSvg(svgString) {
  if (!svgString || typeof svgString !== 'string') return '';
  try {
    return DOMPurify.sanitize(svgString, PURIFY_CONFIG);
  } catch {
    // DOMPurify 极端情况下抛错时，宁可渲染失败也不渲染未清洗的 SVG
    return '';
  }
}

let chartId = 0;

function MermaidDiagram({ chart }) {
  const ref = useRef(null);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${chartId++}`;

    mermaid.render(id, chart).then(({ svg: result }) => {
      if (!cancelled) {
        // 渲染后立即 sanitize，杜绝 mermaid 输出中潜在的 XSS
        const clean = sanitizeSvg(result);
        if (!clean) {
          setError('图表渲染失败：SVG 安全检查未通过');
          return;
        }
        setSvg(clean);
        setError(null);
      }
    }).catch((err) => {
      if (!cancelled) {
        setError(err.message);
      }
    });

    return () => { cancelled = true; };
  }, [chart]);

  if (error) {
    return (
      <pre
        className="overflow-x-auto my-2 emil-code-block"
        style={{
          fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: '13px',
          lineHeight: '1.55',
        }}
      >
        <code style={{ color: 'var(--color-danger)' }}>{chart}</code>
      </pre>
    );
  }

  return (
    <div
      ref={ref}
      className="my-2"
      style={{ overflow: 'auto' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export default memo(MermaidDiagram);
