// 贪吃蛇游戏页面
import React from 'react';
import SnakeGame from '../components/game/snake/SnakeGame';

const SnakeGamePage = ({ onBack }) => {
  return (
    <div className="snake-game-page" style={styles.container}>
      <div style={styles.header}>
        <button
          onClick={onBack}
          style={styles.backButton}
        >
          ← 返回
        </button>
        <h1 style={styles.title}>贪吃蛇对战游戏</h1>
        <div style={styles.subtitle}>多人对战 | 实时竞技 | 休闲娱乐</div>
      </div>
      
      <div style={styles.content}>
        <SnakeGame />
      </div>
      
      <div style={styles.footer}>
        <div style={styles.gameTips}>
          <h3 style={styles.tipsTitle}>游戏提示</h3>
          <ul style={styles.tipsList}>
            <li>收集食物可以增加长度和得分</li>
            <li>不同颜色的食物有不同的效果</li>
            <li>避免撞到墙壁和其他蛇</li>
            <li>多人模式下可以互相竞争</li>
            <li>游戏速度可以随时调整</li>
          </ul>
        </div>
        
        <div style={styles.gameStats}>
          <h3 style={styles.statsTitle}>游戏统计</h3>
          <div style={styles.statsGrid}>
            <div style={styles.statItem}>
              <div style={styles.statLabel}>最高得分</div>
              <div style={styles.statValue}>0</div>
            </div>
            <div style={styles.statItem}>
              <div style={styles.statLabel}>游戏次数</div>
              <div style={styles.statValue}>0</div>
            </div>
            <div style={styles.statItem}>
              <div style={styles.statLabel}>最长存活</div>
              <div style={styles.statValue}>0s</div>
            </div>
            <div style={styles.statItem}>
              <div style={styles.statLabel}>胜利次数</div>
              <div style={styles.statValue}>0</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    width: '100%',
    height: '100vh',
    backgroundColor: '#0f0f1a',
    color: '#ffffff',
    fontFamily: 'Arial, sans-serif',
    overflow: 'auto'
  },
  header: {
    backgroundColor: '#1a1a2e',
    padding: '20px',
    borderBottom: '2px solid #4ECDC4',
    position: 'relative'
  },
  backButton: {
    position: 'absolute',
    left: '20px',
    top: '20px',
    backgroundColor: '#4ECDC4',
    color: '#ffffff',
    border: 'none',
    padding: '8px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 'bold',
    transition: 'all 0.2s ease'
  },
  title: {
    margin: '0',
    textAlign: 'center',
    color: '#4ECDC4',
    fontSize: '32px',
    fontWeight: 'bold'
  },
  subtitle: {
    textAlign: 'center',
    color: '#a0a0c0',
    fontSize: '16px',
    marginTop: '8px'
  },
  content: {
    padding: '20px',
    maxWidth: '1400px',
    margin: '0 auto'
  },
  footer: {
    display: 'flex',
    gap: '20px',
    padding: '20px',
    maxWidth: '1400px',
    margin: '0 auto',
    flexWrap: 'wrap'
  },
  gameTips: {
    flex: 1,
    minWidth: '300px',
    backgroundColor: '#2a2a3e',
    borderRadius: '12px',
    padding: '20px',
    border: '1px solid #4ECDC4'
  },
  tipsTitle: {
    margin: '0 0 15px 0',
    color: '#4ECDC4',
    fontSize: '18px',
    fontWeight: 'bold'
  },
  tipsList: {
    margin: '0',
    paddingLeft: '20px',
    color: '#a0a0c0',
    lineHeight: '1.8'
  },
  gameStats: {
    flex: 1,
    minWidth: '300px',
    backgroundColor: '#2a2a3e',
    borderRadius: '12px',
    padding: '20px',
    border: '1px solid #FFD166'
  },
  statsTitle: {
    margin: '0 0 15px 0',
    color: '#FFD166',
    fontSize: '18px',
    fontWeight: 'bold'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '15px'
  },
  statItem: {
    backgroundColor: '#1a1a2e',
    borderRadius: '8px',
    padding: '15px',
    textAlign: 'center'
  },
  statLabel: {
    fontSize: '14px',
    color: '#a0a0c0',
    marginBottom: '8px'
  },
  statValue: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#FFD166'
  }
};

export default SnakeGamePage;
