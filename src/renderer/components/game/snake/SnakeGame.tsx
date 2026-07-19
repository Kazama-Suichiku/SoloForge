// 贪吃蛇游戏主组件
import React, { useState, useEffect, useCallback } from 'react';
import { useSnakeGame } from './hooks/useSnakeGame';
import SnakeGameCanvas from './SnakeGameCanvas';
import SnakeGameControlPanel from './SnakeGameControlPanel';
import { GameMode } from './types';

const SnakeGame: React.FC = () => {
  const [gameMode, setGameMode] = useState<GameMode>('single');
  const [playerCount, setPlayerCount] = useState<number>(1);
  const [gameSpeed, setGameSpeed] = useState<number>(10);
  
  const {
    gameState,
    initializeGame,
    startGame,
    pauseGame,
    resetGame,
    updateGameConfig
  } = useSnakeGame({
    initialSpeed: gameSpeed,
    gridWidth: 30,
    gridHeight: 20,
    gridSize: 20
  });

  // 初始化游戏
  useEffect(() => {
    initializeGame(playerCount);
  }, [initializeGame, playerCount]);

  // 键盘控制
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (gameState.isRunning) {
            pauseGame();
          } else {
            startGame();
          }
          break;
        case 'Escape':
          e.preventDefault();
          resetGame();
          break;
        case 'w':
        case 'W':
          // 玩家1向上
          break;
        case 's':
        case 'S':
          // 玩家1向下
          break;
        case 'a':
        case 'A':
          // 玩家1向左
          break;
        case 'd':
        case 'D':
          // 玩家1向右
          break;
        case 'ArrowUp':
          // 玩家2向上
          break;
        case 'ArrowDown':
          // 玩家2向下
          break;
        case 'ArrowLeft':
          // 玩家2向左
          break;
        case 'ArrowRight':
          // 玩家2向右
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [gameState.isRunning, startGame, pauseGame, resetGame]);

  // 处理游戏模式变化
  const handleGameModeChange = useCallback((mode: GameMode) => {
    setGameMode(mode);
    // 根据模式调整玩家数量
    if (mode === 'single') {
      setPlayerCount(1);
    } else if (mode === 'multiplayer') {
      setPlayerCount(2);
    } else if (mode === 'ai') {
      setPlayerCount(1); // AI模式：1个玩家 + AI对手
    }
  }, []);

  // 处理玩家数量变化
  const handlePlayerCountChange = useCallback((count: number) => {
    setPlayerCount(count);
    if (count > 1 && gameMode === 'single') {
      setGameMode('multiplayer');
    }
  }, [gameMode]);

  // 处理游戏速度变化
  const handleGameSpeedChange = useCallback((speed: number) => {
    setGameSpeed(speed);
    updateGameConfig({ initialSpeed: speed });
  }, [updateGameConfig]);

  return (
    <div style={styles.container}>
      <div style={styles.gameContainer}>
        <div style={styles.canvasContainer}>
          <SnakeGameCanvas
            gameState={gameState}
            width={800}
            height={600}
          />
        </div>
        
        <div style={styles.controlContainer}>
          <SnakeGameControlPanel
            gameState={gameState}
            gameMode={gameMode}
            onStartGame={startGame}
            onPauseGame={pauseGame}
            onResetGame={resetGame}
            onChangeGameMode={handleGameModeChange}
            onChangePlayerCount={handlePlayerCountChange}
            onChangeGameSpeed={handleGameSpeedChange}
          />
        </div>
      </div>
      
      <div style={styles.playerInfo}>
        <h3 style={styles.playerInfoTitle}>玩家信息</h3>
        <div style={styles.playerList}>
          {gameState.snakes.map((snake, index) => (
            <div
              key={snake.id}
              style={{
                ...styles.playerCard,
                borderColor: snake.color,
                opacity: snake.isAlive ? 1 : 0.5
              }}
            >
              <div style={styles.playerHeader}>
                <div
                  style={{
                    ...styles.playerColor,
                    backgroundColor: snake.color
                  }}
                />
                <span style={styles.playerName}>{snake.name}</span>
                {!snake.isAlive && (
                  <span style={styles.deadLabel}>已阵亡</span>
                )}
              </div>
              <div style={styles.playerStats}>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>得分:</span>
                  <span style={styles.statValue}>{snake.score}</span>
                </div>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>长度:</span>
                  <span style={styles.statValue}>{snake.segments.length}</span>
                </div>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>速度:</span>
                  <span style={styles.statValue}>{snake.speed}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '20px',
    padding: '20px',
    backgroundColor: '#0f0f1a',
    minHeight: '100vh',
    fontFamily: 'Arial, sans-serif'
  },
  gameContainer: {
    display: 'flex',
    gap: '20px',
    flexWrap: 'wrap' as const
  },
  canvasContainer: {
    flex: 1,
    minWidth: '800px'
  },
  controlContainer: {
    width: '350px',
    minWidth: '350px'
  },
  playerInfo: {
    backgroundColor: '#2a2a3e',
    borderRadius: '12px',
    padding: '20px',
    border: '1px solid #4ECDC4'
  },
  playerInfoTitle: {
    margin: '0 0 15px 0',
    color: '#4ECDC4',
    fontSize: '18px',
    fontWeight: 'bold'
  },
  playerList: {
    display: 'flex',
    gap: '15px',
    flexWrap: 'wrap' as const
  },
  playerCard: {
    flex: 1,
    minWidth: '200px',
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '15px',
    border: '2px solid',
    transition: 'all 0.3s ease'
  },
  playerHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '10px'
  },
  playerColor: {
    width: '20px',
    height: '20px',
    borderRadius: '50%'
  },
  playerName: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#ffffff'
  },
  deadLabel: {
    marginLeft: 'auto',
    fontSize: '12px',
    color: '#FF6B6B',
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    padding: '2px 8px',
    borderRadius: '10px'
  },
  playerStats: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px'
  },
  statItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  statLabel: {
    fontSize: '14px',
    color: '#a0a0c0'
  },
  statValue: {
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#FFD166'
  }
} as const;

export default SnakeGame;
