// 贪吃蛇游戏类型定义

export interface Position {
  x: number;
  y: number;
}

export interface SnakeSegment {
  position: Position;
  color: string;
  size: number;
}

export interface Snake {
  id: string;
  name: string;
  segments: SnakeSegment[];
  direction: 'up' | 'down' | 'left' | 'right';
  speed: number;
  color: string;
  gradientColors: string[];
  isAlive: boolean;
  score: number;
  lastDirectionChange: number;
}

export interface Food {
  id: string;
  position: Position;
  type: 'normal' | 'bonus' | 'speed' | 'slow';
  value: number;
  color: string;
  animationState: number;
  size: number;
}

export interface Particle {
  id: string;
  position: Position;
  velocity: { x: number; y: number };
  color: string;
  size: number;
  life: number;
  maxLife: number;
  type: 'sparkle' | 'trail' | 'explosion';
}

export interface GameState {
  snakes: Snake[];
  foods: Food[];
  particles: Particle[];
  gridSize: number;
  gridWidth: number;
  gridHeight: number;
  isRunning: boolean;
  gameSpeed: number;
  score: number;
  timeElapsed: number;
  maxPlayers: number;
  currentPlayers: number;
}

export interface GameConfig {
  gridSize: number;
  gridWidth: number;
  gridHeight: number;
  initialSpeed: number;
  maxSpeed: number;
  minSpeed: number;
  foodSpawnRate: number;
  particleCount: number;
  enableGradients: boolean;
  enableParticles: boolean;
  enableAnimations: boolean;
}

export type GameMode = 'single' | 'multiplayer' | 'ai';
