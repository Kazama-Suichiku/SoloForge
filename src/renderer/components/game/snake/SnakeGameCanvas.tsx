// 贪吃蛇游戏画布组件
import React, { useEffect, useRef, useCallback } from 'react';
import { GameState } from './types';

interface SnakeGameCanvasProps {
  gameState: GameState;
  width?: number;
  height?: number;
}

const SnakeGameCanvas: React.FC<SnakeGameCanvasProps> = ({
  gameState,
  width = 800,
  height = 600
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  // 绘制游戏
  const drawGame = useCallback((ctx: CanvasRenderingContext2D) => {
    const { gridSize, gridWidth, gridHeight, snakes, foods, particles } = gameState;
    
    // 清空画布
    ctx.clearRect(0, 0, width, height);
    
    // 绘制网格背景
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);
    
    // 绘制网格线
    ctx.strokeStyle = '#2a2a3e';
    ctx.lineWidth = 1;
    
    for (let x = 0; x <= gridWidth; x++) {
      ctx.beginPath();
      ctx.moveTo(x * gridSize, 0);
      ctx.lineTo(x * gridSize, gridHeight * gridSize);
      ctx.stroke();
    }
    
    for (let y = 0; y <= gridHeight; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * gridSize);
      ctx.lineTo(gridWidth * gridSize, y * gridSize);
      ctx.stroke();
    }
    
    // 绘制食物
    foods.forEach(food => {
      const { position, type, color, size, animationState } = food;
      
      // 食物动画效果
      const pulseSize = size * (0.8 + 0.2 * Math.sin(animationState * 0.1));
      
      ctx.save();
      ctx.translate(position.x + size / 2, position.y + size / 2);
      
      // 根据食物类型绘制不同形状
      switch (type) {
        case 'normal':
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(0, 0, pulseSize / 2, 0, Math.PI * 2);
          ctx.fill();
          break;
          
        case 'bonus':
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(0, 0, pulseSize / 2, 0, Math.PI * 2);
          ctx.fill();
          
          // 绘制星星效果
          ctx.strokeStyle = '#FFD700';
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let i = 0; i < 5; i++) {
            const angle = (i * Math.PI * 2) / 5;
            const x1 = Math.cos(angle) * pulseSize / 2;
            const y1 = Math.sin(angle) * pulseSize / 2;
            const x2 = Math.cos(angle + Math.PI / 5) * pulseSize / 3;
            const y2 = Math.sin(angle + Math.PI / 5) * pulseSize / 3;
            
            if (i === 0) ctx.moveTo(x1, y1);
            else ctx.lineTo(x1, y1);
            ctx.lineTo(x2, y2);
          }
          ctx.closePath();
          ctx.stroke();
          break;
          
        case 'speed':
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(0, -pulseSize / 2);
          ctx.lineTo(pulseSize / 2, 0);
          ctx.lineTo(0, pulseSize / 2);
          ctx.lineTo(-pulseSize / 2, 0);
          ctx.closePath();
          ctx.fill();
          break;
          
        case 'slow':
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(0, 0, pulseSize / 2, 0, Math.PI * 2);
          ctx.fill();
          
          // 绘制减速符号
          ctx.fillStyle = '#FFFFFF';
          ctx.font = 'bold 12px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('S', 0, 0);
          break;
      }
      
      ctx.restore();
    });
    
    // 绘制蛇
    snakes.forEach(snake => {
      const { segments, color, gradientColors, isAlive, direction } = snake;
      
      if (!isAlive) return;
      
      segments.forEach((segment, index) => {
        const { position, size } = segment;
        
        // 使用渐变色
        const segmentColor = gradientColors[index % gradientColors.length];
        
        ctx.fillStyle = segmentColor;
        ctx.beginPath();
        
        // 蛇头绘制为圆形，身体绘制为圆角矩形
        if (index === 0) {
          // 蛇头
          ctx.arc(
            position.x + size / 2,
            position.y + size / 2,
            size / 2,
            0,
            Math.PI * 2
          );
          
          // 绘制眼睛
          ctx.fill();
          ctx.fillStyle = '#FFFFFF';
          
          // 根据方向绘制眼睛
          const eyeSize = size / 5;
          let eyeX1 = position.x + size / 2;
          let eyeY1 = position.y + size / 2;
          let eyeX2 = position.x + size / 2;
          let eyeY2 = position.y + size / 2;
          
          switch (direction) {
            case 'right':
              eyeX1 += size / 4;
              eyeX2 += size / 4;
              eyeY1 -= size / 6;
              eyeY2 += size / 6;
              break;
            case 'left':
              eyeX1 -= size / 4;
              eyeX2 -= size / 4;
              eyeY1 -= size / 6;
              eyeY2 += size / 6;
              break;
            case 'up':
              eyeX1 -= size / 6;
              eyeX2 += size / 6;
              eyeY1 -= size / 4;
              eyeY2 -= size / 4;
              break;
            case 'down':
              eyeX1 -= size / 6;
              eyeX2 += size / 6;
              eyeY1 += size / 4;
              eyeY2 += size / 4;
              break;
          }
          
          ctx.beginPath();
          ctx.arc(eyeX1, eyeY1, eyeSize, 0, Math.PI * 2);
          ctx.arc(eyeX2, eyeY2, eyeSize, 0, Math.PI * 2);
          ctx.fill();
          
          // 瞳孔
          ctx.fillStyle = '#000000';
          ctx.beginPath();
          ctx.arc(eyeX1, eyeY1, eyeSize / 2, 0, Math.PI * 2);
          ctx.arc(eyeX2, eyeY2, eyeSize / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // 蛇身
          const radius = size / 4;
          ctx.roundRect(
            position.x,
            position.y,
            size,
            size,
            radius
          );
          ctx.fill();
        }
      });
    });
    
    // 绘制粒子效果
    particles.forEach(particle => {
      const { position, color, size, life, maxLife, type } = particle;
      const alpha = life / maxLife;
      
      ctx.save();
      ctx.globalAlpha = alpha;
      
      switch (type) {
        case 'sparkle':
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(position.x, position.y, size, 0, Math.PI * 2);
          ctx.fill();
          break;
          
        case 'trail':
          ctx.strokeStyle = color;
          ctx.lineWidth = size;
          ctx.beginPath();
          ctx.moveTo(position.x, position.y);
          ctx.lineTo(position.x, position.y);
          ctx.stroke();
          break;
          
        case 'explosion':
          ctx.fillStyle = color;
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const angle = (i * Math.PI * 2) / 8;
            const radius = size * (0.5 + 0.5 * Math.sin(life * 0.1));
            const x = position.x + Math.cos(angle) * radius;
            const y = position.y + Math.sin(angle) * radius;
            
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fill();
          break;
      }
      
      ctx.restore();
    });
  }, [gameState, width, height]);

  // 动画循环
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const animate = () => {
      drawGame(ctx);
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    
    animate();
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [drawGame]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        border: '2px solid #4ECDC4',
        borderRadius: '8px',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
      }}
    />
  );
};

export default SnakeGameCanvas;
