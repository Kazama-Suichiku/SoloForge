// 贪吃蛇游戏控制面板组件
import React from 'react';
import { GameState, GameMode } from './types';

interface SnakeGameControlPanelProps {
  gameState: GameState;
  gameMode: GameMode;
  onStartGame: () => void;
  onPauseGame: () => void;
  onResetGame: () => void;
  onChangeGameMode: (mode: GameMode) => void;
  onChangePlayerCount: (count: number) => void;
  onChangeGameSpeed: (speed: number) => void;
}

const SnakeGameControlPanel: React.FC<SnakeGameControlPanelProps> = ({
  gameState,
  gameMode,
  onStartGame,
  onPauseGame,
  onResetGame,
  onChangeGameMode,
  onChangePlayerCount,
  onChangeGameSpeed
}) => {
  const { isRunning, score, timeElapsed, currentPlayers, maxPlayers, gameSpeed } = gameState;

  return (
    <div className="snake-game-control-panel" style={styles.panel}>
      <div style={styles.header}>
        <h2 style={styles.title}>贪吃蛇对战游戏</h2>
        <div style={styles.gameInfo}>
          <div style={styles.infoItem}>
            <span style={styles.infoLabel}>得分:</span>
            <span style={styles.infoValue}>{score}</span>
          </div>
          <div style={styles.infoItem}>
            <span style={styles.infoLabel}>时间:</span>
            <span style={styles.infoValue}>{Math.floor(timeElapsed / 1000)}s</span>
          </div>
          <div style={styles.infoItem}>
            <span style={styles.infoLabel}>玩家:</span>
            <span style={styles.infoValue}>{currentPlayers}/{maxPlayers}</span>
          </div>
        </div>
      </div>

      <div style={styles.controls}>
        <div style={styles.buttonGroup}>
          <button
            onClick={onStartGame}
            disabled={isRunning}
            style={{
              ...styles.button,
              ...styles.primaryButton,
              ...(isRunning ? styles.disabledButton : {})
            }}
          >
            {isRunning ? '游戏中...' : '开始游戏'}
          </button>
          
          <button
            onClick={onPauseGame}
            disabled={!isRunning}
            style={{
              ...styles.button,
              ...styles.secondaryButton,
              ...(!isRunning ? styles.disabledButton : {})
            }}
          >
            {isRunning ? '暂停' : '已暂停'}
          </button>
          
          <button
            onClick={onResetGame}
            style={{
              ...styles.button,
              ...styles.dangerButton
            }}
          >
            重新开始
          </button>
        </div>

        <div style={styles.settings}>
          <div style={styles.settingGroup}>
            <label style={styles.settingLabel}>游戏模式:</label>
            <div style={styles.modeButtons}>
              <button
                onClick={() => onChangeGameMode('single')}
                style={{
                  ...styles.modeButton,
                  ...(gameMode === 'single' ? styles.activeModeButton : {})
                }}
              >
                单人模式
              </button>
              <button
                onClick={() => onChangeGameMode('multiplayer')}
                style={{
                  ...styles.modeButton,
                  ...(gameMode === 'multiplayer' ? styles.activeModeButton : {})
                }}
              >
                多人对战
              </button>
              <button
                onClick={() => onChangeGameMode('ai')}
                style={{
                  ...styles.modeButton,
                  ...(gameMode === 'ai' ? styles.activeModeButton : {})
                }}
              >
                AI对战
              </button>
            </div>
          </div>

          <div style={styles.settingGroup}>
            <label style={styles.settingLabel}>玩家数量:</label>
            <div style={styles.playerButtons}>
              {[1, 2, 3, 4].map(count => (
                <button
                  key={count}
                  onClick={() => onChangePlayerCount(count)}
                  style={{
                    ...styles.playerButton,
                    ...(currentPlayers === count ? styles.activePlayerButton : {})
                  }}
                >
                  {count}人
                </button>
              ))}
            </div>
          </div>

          <div style={styles.settingGroup}>
            <label style={styles.settingLabel}>游戏速度:</label>
            <div style={styles.speedControl}>
              <input
                type="range"
                min="5"
                max="20"
                value={gameSpeed}
                onChange={(e) => onChangeGameSpeed(parseInt(e.target.value))}
                style={styles.speedSlider}
              />
              <span style={styles.speedValue}>{gameSpeed}</span>
            </div>
          </div>
        </div>

        <div style={styles.instructions}>
          <h4 style={styles.instructionsTitle}>操作说明:</h4>
          <ul style={styles.instructionsList}>
            <li>玩家1: WASD 控制方向</li>
            <li>玩家2: 方向键控制方向</li>
            <li>玩家3: IJKL 控制方向</li>
            <li>玩家4: 数字键控制方向</li>
            <li>空格键: 暂停/继续游戏</li>
            <li>ESC键: 重新开始游戏</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

const styles = {
  panel: {
    backgroundColor: '#2a2a3e',
    borderRadius: '12px',
    padding: '20px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
    border: '1px solid #4ECDC4',
    color: '#ffffff',
    fontFamily: 'Arial, sans-serif'
  },
  header: {
    marginBottom: '20px',
    borderBottom: '2px solid #4ECDC4',
    paddingBottom: '15px'
  },
  title: {
    margin: '0 0 10px 0',
    color: '#4ECDC4',
    fontSize: '24px',
    fontWeight: 'bold'
  },
  gameInfo: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '20px'
  },
  infoItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center'
  },
  infoLabel: {
    fontSize: '14px',
    color: '#a0a0c0',
    marginBottom: '4px'
  },
  infoValue: {
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#FFD166'
  },
  controls: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px'
  },
  buttonGroup: {
    display: 'flex',
    gap: '10px',
    justifyContent: 'center'
  },
  button: {
    padding: '10px 20px',
    borderRadius: '6px',
    border: 'none',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    minWidth: '100px'
  },
  primaryButton: {
    backgroundColor: '#4ECDC4',
    color: '#ffffff'
  },
  secondaryButton: {
    backgroundColor: '#FFD166',
    color: '#333333'
  },
  dangerButton: {
    backgroundColor: '#FF6B6B',
    color: '#ffffff'
  },
  disabledButton: {
    opacity: 0.5,
    cursor: 'not-allowed'
  },
  settings: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
    backgroundColor: '#1a1a2e',
    padding: '15px',
    borderRadius: '8px'
  },
  settingGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  settingLabel: {
    fontSize: '14px',
    color: '#a0a0c0',
    fontWeight: 'bold'
  },
  modeButtons: {
    display: 'flex',
    gap: '8px'
  },
  modeButton: {
    flex: 1,
    padding: '8px 12px',
    backgroundColor: '#2a2a3e',
    border: '1px solid #4ECDC4',
    color: '#ffffff',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    fontSize: '12px'
  },
  activeModeButton: {
    backgroundColor: '#4ECDC4',
    color: '#ffffff'
  },
  playerButtons: {
    display: 'flex',
    gap: '8px'
  },
  playerButton: {
    flex: 1,
    padding: '8px 12px',
    backgroundColor: '#2a2a3e',
    border: '1px solid #FFD166',
    color: '#ffffff',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    fontSize: '12px'
  },
  activePlayerButton: {
    backgroundColor: '#FFD166',
    color: '#333333'
  },
  speedControl: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px'
  },
  speedSlider: {
    flex: 1,
    height: '6px',
    borderRadius: '3px',
    background: 'linear-gradient(to right, #4ECDC4, #FFD166)',
    outline: 'none',
    WebkitAppearance: 'none',
    appearance: 'none'
  },
  speedValue: {
    minWidth: '30px',
    textAlign: 'center',
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#FFD166'
  },
  instructions: {
    backgroundColor: '#1a1a2e',
    padding: '15px',
    borderRadius: '8px',
    border: '1px solid #4ECDC4'
  },
  instructionsTitle: {
    margin: '0 0 10px 0',
    color: '#4ECDC4',
    fontSize: '16px'
  },
  instructionsList: {
    margin: '0',
    paddingLeft: '20px',
    fontSize: '12px',
    color: '#a0a0c0',
    lineHeight: '1.6'
  }
} as const;

export default SnakeGameControlPanel;
