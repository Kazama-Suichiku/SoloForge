// 贪吃蛇游戏钩子
import { useState, useEffect, useCallback, useRef } from 'react';
import { GameState, GameConfig, Snake, Food, Particle, Position } from '../types';
import {
  generateRandomPosition,
  isPositionOccupied,
  generateGradientColors,
  generateParticles,
  updateParticles,
  updateFoodAnimation,
  checkCollision,
  generateSnakeSegments
} from '../utils/gameUtils';

const DEFAULT_CONFIG: GameConfig = {
  gridSize: 20,
  gridWidth: 30,
  gridHeight: 20,
  initialSpeed: 10,
  maxSpeed: 20,
  minSpeed: 5,
  foodSpawnRate: 0.05,
  particleCount: 50,
  enableGradients: true,
  enableParticles: true,
  enableAnimations: true
};

const INITIAL_STATE: GameState = {
  snakes: [],
  foods: [],
  particles: [],
  gridSize: DEFAULT_CONFIG.gridSize,
  gridWidth: DEFAULT_CONFIG.gridWidth,
  gridHeight: DEFAULT_CONFIG.gridHeight,
  isRunning: false,
  gameSpeed: DEFAULT_CONFIG.initialSpeed,
  score: 0,
  timeElapsed: 0,
  maxPlayers: 4,
  currentPlayers: 1
};

const PLAYER_COLORS = [
  '#FF6B6B', // 红色
  '#4ECDC4', // 青色
  '#FFD166', // 黄色
  '#06D6A0', // 绿色
  '#118AB2', // 蓝色
  '#EF476F', // 粉色
  '#7209B7', // 紫色
  '#F3722C'  // 橙色
];

export const useSnakeGame = (config: Partial<GameConfig> = {}) => {
  const [gameState, setGameState] = useState<GameState>(INITIAL_STATE);
  const [gameConfig, setGameConfig] = useState<GameConfig>({ ...DEFAULT_CONFIG, ...config });
  const gameLoopRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const keysPressedRef = useRef<Set<string>>(new Set());

  // 初始化游戏
  const initializeGame = useCallback((playerCount: number = 1) => {
    const snakes: Snake[] = [];
    
    for (let i = 0; i < playerCount; i++) {
      const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
      const startX = Math.floor(gameConfig.gridWidth / 4) * gameConfig.gridSize;
      const startY = Math.floor(gameConfig.gridHeight / 2) * gameConfig.gridSize + i * gameConfig.gridSize * 2;
      
      snakes.push({
        id: `snake-${i}`,
        name: `玩家 ${i + 1}`,
        segments: [
          { position: { x: startX, y: startY }, color, size: gameConfig.gridSize },
          { position: { x: startX - gameConfig.gridSize, y: startY }, color, size: gameConfig.gridSize * 0.9 },
          { position: { x: startX - gameConfig.gridSize * 2, y: startY }, color, size: gameConfig.gridSize * 0.8 }
        ],
        direction: 'right',
        speed: gameConfig.initialSpeed,
        color,
        gradientColors: generateGradientColors(color, 10),
        isAlive: true,
        score: 0,
        lastDirectionChange: Date.now()
      });
    }

    // 生成初始食物
    const foods: Food[] = [];
    for (let i = 0; i < 5; i++) {
      let position: Position;
      do {
        position = generateRandomPosition(gameConfig.gridWidth, gameConfig.gridHeight, gameConfig.gridSize);
      } while (isPositionOccupied(position, snakes, foods, gameConfig.gridSize));

      foods.push({
        id: `food-${i}`,
        position,
        type: 'normal',
        value: 1,
        color: '#FFD166',
        animationState: Math.random() * Math.PI * 2,
        size: gameConfig.gridSize * 0.8
      });
    }

    setGameState(prev => ({
      ...prev,
      snakes,
      foods,
      particles: [],
      isRunning: true,
      score: 0,
      timeElapsed: 0,
      currentPlayers: playerCount
    }));
  }, [gameConfig]);

  // 处理键盘输入
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    keysPressedRef.current.add(event.key.toLowerCase());
  }, []);

  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    keysPressedRef.current.delete(event.key.toLowerCase());
  }, []);

  // 更新蛇的方向
  const updateSnakeDirection = useCallback((snake: Snake, index: number): Snake => {
    const now = Date.now();
    const directionChangeCooldown = 100; // 方向改变冷却时间（毫秒）
    
    if (now - snake.lastDirectionChange < directionChangeCooldown) {
      return snake;
    }

    const keys = Array.from(keysPressedRef.current);
    let newDirection = snake.direction;

    // 玩家1控制（WASD）
    if (index === 0) {
      if (keys.includes('w') && snake.direction !== 'down') newDirection = 'up';
      if (keys.includes('s') && snake.direction !== 'up') newDirection = 'down';
      if (keys.includes('a') && snake.direction !== 'right') newDirection = 'left';
      if (keys.includes('d') && snake.direction !== 'left') newDirection = 'right';
    }
    // 玩家2控制（方向键）
    else if (index === 1) {
      if (keys.includes('arrowup') && snake.direction !== 'down') newDirection = 'up';
      if (keys.includes('arrowdown') && snake.direction !== 'up') newDirection = 'down';
      if (keys.includes('arrowleft') && snake.direction !== 'right') newDirection = 'left';
      if (keys.includes('arrowright') && snake.direction !== 'left') newDirection = 'right';
    }

    if (newDirection !== snake.direction) {
      return {
        ...snake,
        direction: newDirection,
        lastDirectionChange: now
      };
    }

    return snake;
  }, []);

  // 移动蛇
  const moveSnake = useCallback((snake: Snake): Snake => {
    if (!snake.isAlive) return snake;

    const head = snake.segments[0];
    let newHeadPosition = { ...head.position };

    switch (snake.direction) {
      case 'up':
        newHeadPosition.y -= gameConfig.gridSize;
        break;
      case 'down':
        newHeadPosition.y += gameConfig.gridSize;
        break;
      case 'left':
        newHeadPosition.x -= gameConfig.gridSize;
        break;
      case 'right':
        newHeadPosition.x += gameConfig.gridSize;
        break;
    }

    // 检查碰撞
    const collision = checkCollision(
      newHeadPosition,
      gameState.snakes,
      gameConfig.gridWidth,
      gameConfig.gridHeight,
      gameConfig.gridSize
    );

    if (collision !== 'none') {
      // 死亡效果
      const deathParticles = gameConfig.enableParticles
        ? generateParticles(head.position, gameConfig.particleCount, 'explosion', snake.color)
        : [];

      return {
        ...snake,
        isAlive: false,
        segments: generateSnakeSegments(snake, gameConfig.gridSize)
      };
    }

    // 移动蛇身
    const newSegments = [
      { ...head, position: newHeadPosition, size: gameConfig.gridSize },
      ...snake.segments.slice(0, -1)
    ];

    // 检查是否吃到食物
    let ateFood = false;
    const newFoods = gameState.foods.filter(food => {
      if (food.position.x === newHeadPosition.x && food.position.y === newHeadPosition.y) {
        ateFood = true;
        
        // 添加食物粒子效果
        if (gameConfig.enableParticles) {
          const foodParticles = generateParticles(food.position, 10, 'sparkle', food.color);
          setGameState(prev => ({
            ...prev,
            particles: [...prev.particles, ...foodParticles]
          }));
        }
        
        // 增加蛇的长度
        newSegments.push({
          position: snake.segments[snake.segments.length - 1].position,
          color: snake.color,
          size: gameConfig.gridSize * 0.7
        });
        
        return false;
      }
      return true;
    });

    if (ateFood) {
      setGameState(prev => ({
        ...prev,
        score: prev.score + 10,
        foods: newFoods
      }));
    }

    // 添加移动轨迹粒子
    if (gameConfig.enableParticles && Math.random() > 0.7) {
      const trailParticles = generateParticles(
        { x: newHeadPosition.x + gameConfig.gridSize / 2, y: newHeadPosition.y + gameConfig.gridSize / 2 },
        2,
        'trail',
        snake.color
      );
      setGameState(prev => ({
        ...prev,
        particles: [...prev.particles, ...trailParticles]
      }));
    }

    return {
      ...snake,
      segments: generateSnakeSegments({ ...snake, segments: newSegments }, gameConfig.gridSize),
      score: snake.score + (ateFood ? 10 : 0)
    };
  }, [gameState, gameConfig]);

  // 游戏主循环
  const gameLoop = useCallback((timestamp: number) => {
    if (!gameState.isRunning) return;

    const deltaTime = timestamp - lastUpdateRef.current;
    const updateInterval = 1000 / gameState.gameSpeed;

    if (deltaTime >= updateInterval) {
      lastUpdateRef.current = timestamp;

      setGameState(prev => {
        // 更新蛇的方向
        const updatedSnakes = prev.snakes.map((snake, index) => {
          const snakeWithUpdatedDirection = updateSnakeDirection(snake, index);
          return moveSnake(snakeWithUpdatedDirection);
        });

        // 更新粒子
        const updatedParticles = gameConfig.enableParticles
          ? updateParticles(prev.particles)
          : [];

        // 更新食物动画
        const updatedFoods = gameConfig.enableAnimations
          ? updateFoodAnimation(prev.foods)
          : prev.foods;

        // 随机生成新食物
        let newFoods = [...updatedFoods];
        if (Math.random() < gameConfig.foodSpawnRate && newFoods.length < 15) {
          let position: Position;
          do {
            position = generateRandomPosition(gameConfig.gridWidth, gameConfig.gridHeight, gameConfig.gridSize);
          } while (isPositionOccupied(position, updatedSnakes, newFoods, gameConfig.gridSize));

          const foodTypes: Array<'normal' | 'bonus' | 'speed' | 'slow'> = ['normal', 'bonus', 'speed', 'slow'];
          const type = foodTypes[Math.floor(Math.random() * foodTypes.length)];
          
          const foodColors = {
            normal: '#FFD166',
            bonus: '#EF476F',
            speed: '#06D6A0',
            slow: '#118AB2'
          };

          newFoods.push({
            id: `food-${Date.now()}`,
            position,
            type,
            value: type === 'bonus' ? 5 : 1,
            color: foodColors[type],
            animationState: Math.random() * Math.PI * 2,
            size: gameConfig.gridSize * 0.8
          });
        }

        return {
          ...prev,
          snakes: updatedSnakes,
          foods: newFoods,
          particles: updatedParticles,
          timeElapsed: prev.timeElapsed + 1
        };
      });
    }

    gameLoopRef.current = requestAnimationFrame(gameLoop);
  }, [gameState.isRunning, gameConfig, updateSnakeDirection, moveSnake]);

  // 开始游戏
  const startGame = useCallback((playerCount: number = 1) => {
    initializeGame(playerCount);
  }, [initializeGame]);

  // 暂停/继续游戏
  const togglePause = useCallback(() => {
    setGameState(prev => ({ ...prev, isRunning: !prev.isRunning }));
  }, []);

  // 重置游戏
  const resetGame = useCallback(() => {
    if (gameLoopRef.current) {
      cancelAnimationFrame(gameLoopRef.current);
    }
    setGameState(INITIAL_STATE);
  }, []);

  // 更新配置
  const updateConfig = useCallback((newConfig: Partial<GameConfig>) => {
    setGameConfig(prev => ({ ...prev, ...newConfig }));
  }, []);

  // 添加玩家
  const addPlayer = useCallback(() => {
    if (gameState.currentPlayers >= gameState.maxPlayers) return;

    const newPlayerIndex = gameState.currentPlayers;
    const color = PLAYER_COLORS[newPlayerIndex % PLAYER_COLORS.length];
    const startX = Math.floor(gameConfig.gridWidth / 4) * gameConfig.gridSize;
    const startY = Math.floor(gameConfig.gridHeight / 2) * gameConfig.gridSize + newPlayerIndex * gameConfig.gridSize * 2;

    const newSnake: Snake = {
      id: `snake-${newPlayerIndex}`,
      name: `玩家 ${newPlayerIndex + 1}`,
      segments: [
        { position: { x: startX, y: startY }, color, size: gameConfig.gridSize },
        { position: { x: startX - gameConfig.gridSize, y: startY }, color, size: gameConfig.gridSize * 0.9 },
        { position: { x: startX - gameConfig.gridSize * 2, y: startY }, color, size: gameConfig.gridSize * 0.8 }
      ],
      direction: 'right',
      speed: gameConfig.initialSpeed,
      color,
      gradientColors: generateGradientColors(color, 10),
      isAlive: true,
      score: 0,
      lastDirectionChange: Date.now()
    };

    setGameState(prev => ({
      ...prev,
      snakes: [...prev.snakes, newSnake],
      currentPlayers: prev.currentPlayers + 1
    }));
  }, [gameState, gameConfig]);

  // 移除玩家
  const removePlayer = useCallback(() => {
    if (gameState.currentPlayers <= 1) return;

    setGameState(prev => ({
      ...prev,
      snakes: prev.snakes.slice(0, -1),
      currentPlayers: prev.currentPlayers - 1
    }));
  }, [gameState]);

  // 设置键盘事件监听
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  // 启动游戏循环
  useEffect(() => {
    if (gameState.isRunning) {
      lastUpdateRef.current = performance.now();
      gameLoopRef.current = requestAnimationFrame(gameLoop);
    } else if (gameLoopRef.current) {
      cancelAnimationFrame(gameLoopRef.current);
    }

    return () => {
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current);
      }
    };
  }, [gameState.isRunning, gameLoop]);

  return {
    gameState,
    gameConfig,
    startGame,
    togglePause,
    resetGame,
    updateConfig,
    addPlayer,
    removePlayer
  };
};
