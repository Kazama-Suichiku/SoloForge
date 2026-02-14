# SoloForge 云同步使用示例

## 前端集成示例

### 1. 在设置页面添加登录按钮

```jsx
// src/renderer/pages/Settings.jsx
import React, { useState } from 'react';
import LoginDialog from '../components/sync/LoginDialog';
import SyncStatus from '../components/sync/SyncStatus';

export default function Settings() {
  const [showLogin, setShowLogin] = useState(false);
  const [user, setUser] = useState(null);

  // 检查登录状态
  React.useEffect(() => {
    window.electron.sync.getUser().then(result => {
      if (result.success) {
        setUser(result.user);
      }
    });
  }, []);

  const handleLogout = async () => {
    await window.electron.sync.logout();
    setUser(null);
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">设置</h1>
      
      {/* 云同步区域 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 mb-4">
        <h2 className="text-lg font-semibold mb-4">云同步</h2>
        
        {user ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  已登录: {user.email}
                </p>
                <SyncStatus />
              </div>
              <button
                onClick={handleLogout}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded"
              >
                登出
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowLogin(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded"
          >
            登录/注册
          </button>
        )}
      </div>

      <LoginDialog
        isOpen={showLogin}
        onClose={() => setShowLogin(false)}
        onSuccess={(user) => setUser(user)}
      />
    </div>
  );
}
```

### 2. 在顶部导航栏显示同步状态

```jsx
// src/renderer/App.jsx
import SyncStatus from './components/sync/SyncStatus';

export default function App() {
  return (
    <div className="app">
      <header className="flex items-center justify-between p-4">
        <h1>SoloForge</h1>
        <SyncStatus />
      </header>
      {/* ... */}
    </div>
  );
}
```

## 后端 API 使用

### 初始化同步系统

```javascript
// 在主进程启动时自动初始化
const { initializeSync } = require('./sync');
initializeSync();
```

### 手动触发同步

```javascript
// 渲染进程
const result = await window.electron.sync.manualSync();
console.log('同步结果:', result);
```

### 监听同步事件

```javascript
// 主进程
const { syncManager } = require('./sync');

syncManager.on('sync:start', () => {
  console.log('开始同步...');
});

syncManager.on('sync:complete', (results) => {
  console.log('同步完成:', results);
});

syncManager.on('sync:error', (error) => {
  console.error('同步失败:', error);
});

syncManager.on('sync:conflict', ({ adapter, conflicts }) => {
  console.warn('检测到冲突:', adapter, conflicts);
  // 可以在这里弹出冲突解决对话框
});
```

## 添加新的数据适配器

### 1. 创建适配器类

```javascript
// src/main/sync/data-adapters/permissions-adapter.js
const { BaseAdapter } = require('./base-adapter');
const { permissionStore } = require('../../config/permission-store');

class PermissionsAdapter extends BaseAdapter {
  constructor() {
    super('permissions', permissionStore);
  }

  async getLocal() {
    const permissions = permissionStore.getAllPermissions();
    return Object.entries(permissions).map(([agentId, perms]) => ({
      id: agentId,
      agent_id: agentId,
      permissions: perms,
      updated_at: new Date().toISOString(),
      version: 1
    }));
  }

  async updateLocal(data) {
    for (const item of data) {
      permissionStore.setPermissions(item.agent_id, item.permissions);
    }
    return { success: true };
  }
}

module.exports = { PermissionsAdapter };
```

### 2. 注册适配器

```javascript
// src/main/sync/index.js
const { PermissionsAdapter } = require('./data-adapters/permissions-adapter');

function initializeSync() {
  // ...
  syncManager.registerAdapter('permissions', new PermissionsAdapter());
  // ...
}
```

## 测试流程

### 1. 本地测试

```bash
# 启动应用
npm run dev

# 在设置页面:
# 1. 点击"登录/注册"
# 2. 注册新账号
# 3. 登录
# 4. 观察同步状态
# 5. 修改 Agent 配置
# 6. 等待自动同步或点击"手动同步"
```

### 2. 多设备测试

```bash
# 设备 A
1. 登录账号
2. 修改数据
3. 等待同步完成

# 设备 B
1. 登录同一账号
2. 观察数据是否自动同步
3. 修改数据
4. 返回设备 A 查看是否同步
```

## 故障排查

### 查看同步日志

```javascript
// 主进程日志位于
~/.soloforge/logs/main.log

// 搜索同步相关日志
grep "sync" ~/.soloforge/logs/main.log
```

### 手动清除本地缓存

```javascript
// 渲染进程控制台
localStorage.clear();
location.reload();
```

### 重置同步状态

```javascript
// 主进程
const { authManager } = require('./sync');
await authManager.logout();
```
