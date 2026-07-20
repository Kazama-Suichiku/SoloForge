import { memo, useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
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
        setSvg(result);
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
