// 贪吃蛇游戏工具函数
import { Position, Snake, Food, Particle, GameConfig } from '../types';

// 生成随机位置
export const generateRandomPosition = (gridWidth: number, gridHeight: number, gridSize: number): Position => {
  return {
    x: Math.floor(Math.random() * gridWidth) * gridSize,
    y: Math.floor(Math.random() * gridHeight) * gridSize
  };
};

// 检查位置是否被占用
export const isPositionOccupied = (
  position: Position,
  snakes: Snake[],
  foods: Food[],
  gridSize: number
): boolean => {
  // 检查蛇身
  for (const snake of snakes) {
    for (const segment of snake.segments) {
      if (segment.position.x === position.x && segment.position.y === position.y) {
        return true;
      }
    }
  }
  
  // 检查食物
  for (const food of foods) {
    if (food.position.x === position.x && food.position.y === position.y) {
      return true;
    }
  }
  
  return false;
};

// 生成渐变色
export const generateGradientColors = (baseColor: string, count: number): string[] => {
  const colors: string[] = [];
  
  // 将十六进制颜色转换为RGB
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
  };
  
  // RGB转十六进制
  const rgbToHex = (r: number, g: number, b: number) => {
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  };
  
  const baseRgb = hexToRgb(baseColor);
  
  for (let i = 0; i < count; i++) {
    const factor = i / (count - 1);
    const r = Math.min(255, Math.max(0, Math.floor(baseRgb.r * (1 - factor * 0.3))));
    const g = Math.min(255, Math.max(0, Math.floor(baseRgb.g * (1 - factor * 0.3))));
    const b = Math.min(255, Math.max(0, Math.floor(baseRgb.b * (1 - factor * 0.3))));
    
    colors.push(rgbToHex(r, g, b));
  }
  
  return colors;
};

// 生成粒子效果
export const generateParticles = (
  position: Position,
  count: number,
  type: 'sparkle' | 'trail' | 'explosion',
  color: string
): Particle[] => {
  const particles: Particle[] = [];
  
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = type === 'explosion' ? 2 + Math.random() * 3 : 0.5 + Math.random() * 1;
    
    particles.push({
      id: `particle-${Date.now()}-${i}`,
      position: { ...position },
      velocity: {
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed
      },
      color,
      size: type === 'sparkle' ? 2 + Math.random() * 3 : 1 + Math.random() * 2,
      life: 1,
      maxLife: type === 'explosion' ? 30 + Math.random() * 20 : 20 + Math.random() * 10,
      type
    });
  }
  
  return particles;
};

// 更新粒子
export const updateParticles = (particles: Particle[]): Particle[] => {
  return particles
    .map(particle => {
      const newParticle = { ...particle };
      
      // 更新位置
      newParticle.position.x += newParticle.velocity.x;
      newParticle.position.y += newParticle.velocity.y;
      
      // 更新生命周期
      newParticle.life -= 1 / newParticle.maxLife;
      
      // 添加重力效果（仅对爆炸粒子）
      if (newParticle.type === 'explosion') {
        newParticle.velocity.y += 0.1;
      }
      
      return newParticle;
    })
    .filter(particle => particle.life > 0);
};

// 生成食物动画状态
export const updateFoodAnimation = (foods: Food[]): Food[] => {
  return foods.map(food => {
    const newFood = { ...food };
    newFood.animationState = (newFood.animationState + 0.1) % (Math.PI * 2);
    
    // 根据动画状态调整大小
    newFood.size = 0.8 + Math.sin(newFood.animationState) * 0.2;
    
    return newFood;
  });
};

// 检查碰撞
export const checkCollision = (
  position: Position,
  snakes: Snake[],
  gridWidth: number,
  gridHeight: number,
  gridSize: number
): 'wall' | 'snake' | 'none' => {
  // 检查墙壁碰撞
  if (
    position.x < 0 ||
    position.y < 0 ||
    position.x >= gridWidth * gridSize ||
    position.y >= gridHeight * gridSize
  ) {
    return 'wall';
  }
  
  // 检查蛇身碰撞
  for (const snake of snakes) {
    for (const segment of snake.segments) {
      if (segment.position.x === position.x && segment.position.y === position.y) {
        return 'snake';
      }
    }
  }
  
  return 'none';
};

// 生成蛇的渐变色段
export const generateSnakeSegments = (
  snake: Snake,
  gridSize: number
): Snake['segments'] => {
  return snake.segments.map((segment, index) => {
    const colorIndex = Math.min(index, snake.gradientColors.length - 1);
    return {
      ...segment,
      color: snake.gradientColors[colorIndex],
      size: gridSize * (0.9 - index * 0.02) // 尾部逐渐变小
    };
  });
};
