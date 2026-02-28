/**
 * 设置页面 - 支持双向云同步
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { storage } from '../core/storage';
import { llm } from '../core/llm';
import { importService } from '../core/import';
import { syncService } from '../core/sync';
import { cloudSync } from '../core/sync/cloudSync';
import { updateService } from '../core/update';
import { authService } from '../core/auth';

interface BossConfig {
  name: string;
  avatar: string;
  avatarThumb?: string;
  avatarFull?: string;
}

const isImageAvatar = (avatar?: string): boolean => {
  if (!avatar) return false;
  return avatar.startsWith('data:image') || avatar.startsWith('http');
};

interface CloudSyncConfig {
  syncUrl: string;
  userId: string;
  isConfigured: boolean;
}

const APP_VERSION = '2.2.0';
const DEFAULT_SYNC_URL = 'https://soloforge-sync.fengzhongcuizhu.workers.dev';

interface Props {
  onLogout?: () => void;
}

export default function SettingsScreen({ onLogout }: Props) {
  const [bossConfig, setBossConfig] = useState<BossConfig>({ name: '老板', avatar: '👑' });
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string>('');
  
  // 云同步配置 - 默认填入服务器地址
  const [cloudSyncUrl, setCloudSyncUrl] = useState(DEFAULT_SYNC_URL);
  const [cloudUserId, setCloudUserId] = useState('');
  const [cloudSyncConfigured, setCloudSyncConfigured] = useState(false);
  const [savingCloudConfig, setSavingCloudConfig] = useState(false);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  
  // 更新检查
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  // 登录状态
  const [authState, setAuthState] = useState(authService.getState());

  useEffect(() => {
    loadSettings();
    loadCloudSyncConfig();
    loadAuthState();
  }, []);

  const loadAuthState = async () => {
    await authService.initialize();
    const state = authService.getState();
    setAuthState(state);
    
    // 如果已登录，自动设置用户 ID
    if (state.isLoggedIn && state.userId) {
      setCloudUserId(state.userId);
      // 自动配置云同步
      await cloudSync.configure({
        syncUrl: DEFAULT_SYNC_URL,
        userId: state.userId,
      });
      setCloudSyncConfigured(true);
    }
  };

  const loadSettings = async () => {
    try {
      const config = await storage.getBossConfig();
      setBossConfig(config);
      
      const key = await storage.getApiKey();
      if (key) {
        setApiKey(key.substring(0, 8) + '...' + key.substring(key.length - 4));
      }

      const syncTime = await syncService.getLastSyncTime();
      if (syncTime) {
        setLastSync(new Date(syncTime).toLocaleString('zh-CN'));
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadCloudSyncConfig = async () => {
    try {
      await cloudSync.initialize();
      const config = cloudSync.getConfig();
      // 如果已配置则使用配置的值，否则使用默认服务器地址
      setCloudSyncUrl(config.syncUrl || DEFAULT_SYNC_URL);
      setCloudUserId(config.userId || '');
      setCloudSyncConfigured(config.isConfigured);
      
      // 设置更新服务的服务器地址（默认使用配置的或默认地址）
      updateService.setServerUrl(config.syncUrl || DEFAULT_SYNC_URL);
    } catch (error) {
      console.error('Failed to load cloud sync config:', error);
    }
  };

  const checkForUpdate = async () => {
    if (!cloudSyncUrl) {
      Alert.alert('提示', '请先配置云同步服务器');
      return;
    }
    
    setCheckingUpdate(true);
    try {
      updateService.setServerUrl(cloudSyncUrl);
      const update = await updateService.checkForUpdate(true);
      if (update) {
        updateService.promptUpdate(update);
      }
    } catch (error) {
      Alert.alert('检查更新失败', (error as Error).message);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      '确认退出',
      '退出登录后，云同步功能将不可用。本地数据会保留。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '退出',
          style: 'destructive',
          onPress: async () => {
            cloudSync.stopAutoSync();
            await authService.logout();
            if (onLogout) {
              onLogout();
            }
          },
        },
      ]
    );
  };

  const saveCloudSyncConfig = async () => {
    if (!cloudSyncUrl.trim() || !cloudUserId.trim()) {
      Alert.alert('提示', '请填写同步服务器地址和用户 ID');
      return;
    }

    setSavingCloudConfig(true);
    try {
      await cloudSync.configure({
        syncUrl: cloudSyncUrl.trim(),
        userId: cloudUserId.trim(),
      });
      setCloudSyncConfigured(true);
      Alert.alert('成功', '云同步配置已保存');
    } catch (error) {
      Alert.alert('错误', '保存配置失败');
    } finally {
      setSavingCloudConfig(false);
    }
  };

  const performCloudSync = async () => {
    if (!cloudSyncConfigured) {
      Alert.alert('提示', '请先配置云同步');
      return;
    }

    setCloudSyncing(true);
    try {
      const result = await cloudSync.sync();
      if (result.success) {
        const pulled = result.pulled || { messages: 0, conversations: 0, agents: 0, boss: 0 };
        const pushed = result.pushed || { messages: 0, conversations: 0, agents: 0, boss: 0 };
        Alert.alert(
          '同步完成',
          `拉取: ${pulled.messages} 消息, ${pulled.conversations} 会话, ${pulled.agents} Agent\n` +
          `推送: ${pushed.messages} 消息, ${pushed.conversations} 会话, ${pushed.agents} Agent`
        );
        setLastSync(new Date().toLocaleString('zh-CN'));
      } else {
        Alert.alert('同步失败', result.error || '未知错误');
      }
    } catch (error) {
      Alert.alert('同步错误', (error as Error).message);
    } finally {
      setCloudSyncing(false);
    }
  };

  const saveBossConfig = async () => {
    setSaving(true);
    try {
      await storage.setBossConfig(bossConfig);
      Alert.alert('成功', '老板信息已保存');
    } catch (error) {
      Alert.alert('错误', '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const saveApiKey = async () => {
    if (!apiKey.trim() || apiKey.includes('...')) {
      Alert.prompt(
        '设置 API Key',
        '请输入 DeepSeek API Key',
        [
          { text: '取消', style: 'cancel' },
          {
            text: '保存',
            onPress: async (value) => {
              if (value && value.trim()) {
                setSavingKey(true);
                try {
                  await llm.setApiKey(value.trim());
                  setApiKey(value.substring(0, 8) + '...' + value.substring(value.length - 4));
                  Alert.alert('成功', 'API Key 已保存');
                } catch (error) {
                  Alert.alert('错误', '保存失败');
                } finally {
                  setSavingKey(false);
                }
              }
            },
          },
        ],
        'plain-text',
        '',
        'default'
      );
      return;
    }

    setSavingKey(true);
    try {
      await llm.setApiKey(apiKey.trim());
      Alert.alert('成功', 'API Key 已保存');
    } catch (error) {
      Alert.alert('错误', '保存失败');
    } finally {
      setSavingKey(false);
    }
  };

  const clearData = () => {
    Alert.alert(
      '清除数据',
      '确定要清除所有本地数据吗？这将删除聊天历史、Agent 配置等。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清除',
          style: 'destructive',
          onPress: async () => {
            await storage.clear();
            Alert.alert('已清除', '所有数据已清除，请重启应用');
          },
        },
      ]
    );
  };

  const importData = async () => {
    if (!importJson.trim()) {
      Alert.alert('提示', '请粘贴导出的 JSON 数据');
      return;
    }

    setImporting(true);
    try {
      const result = await importService.importFromJson(importJson);
      if (result.success) {
        Alert.alert(
          '导入成功',
          `已导入:\n- Agents: ${result.stats.agents}\n- 会话: ${result.stats.conversations}\n- 消息: ${result.stats.messages}\n- 记忆: ${result.stats.memory}`
        );
        setImportJson('');
        loadSettings();
      } else {
        Alert.alert('导入失败', result.error || '未知错误');
      }
    } catch (error) {
      Alert.alert('导入失败', (error as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text) {
        setImportJson(text);
      } else {
        Alert.alert('提示', '剪贴板为空');
      }
    } catch {
      Alert.alert('错误', '无法读取剪贴板');
    }
  };

  const uploadToCloud = async () => {
    setSyncing(true);
    try {
      const result = await syncService.upload();
      if (result.success) {
        Alert.alert('成功', result.message);
        setLastSync(new Date().toLocaleString('zh-CN'));
      } else {
        Alert.alert('失败', result.message);
      }
    } catch (error) {
      Alert.alert('错误', (error as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const downloadFromCloud = async () => {
    setSyncing(true);
    try {
      const result = await syncService.download();
      if (result.success) {
        Alert.alert(
          '同步成功',
          `${result.message}\n导入: ${result.stats?.agents || 0} 个 Agent, ${result.stats?.conversations || 0} 个会话`
        );
        setLastSync(new Date().toLocaleString('zh-CN'));
      } else {
        Alert.alert('失败', result.message);
      }
    } catch (error) {
      Alert.alert('错误', (error as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* API Key 配置 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🔑 API 配置</Text>
        <Text style={styles.description}>
          配置 DeepSeek API Key 以启用 AI 聊天功能
        </Text>
        
        <TextInput
          style={styles.input}
          value={apiKey}
          onChangeText={setApiKey}
          placeholder="sk-..."
          placeholderTextColor="#666"
          secureTextEntry={!apiKey.includes('...')}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TouchableOpacity
          style={[styles.button, savingKey && styles.buttonDisabled]}
          onPress={saveApiKey}
          disabled={savingKey}
        >
          <Text style={styles.buttonText}>
            {savingKey ? '保存中...' : apiKey ? '更新 API Key' : '设置 API Key'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 老板信息 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>👤 老板信息</Text>
        
        <View style={styles.avatarRow}>
          {isImageAvatar(bossConfig.avatarThumb) || isImageAvatar(bossConfig.avatar) ? (
            <Image
              source={{ uri: bossConfig.avatarThumb || bossConfig.avatar }}
              style={styles.avatarImage}
              resizeMode="cover"
            />
          ) : (
            <Text style={styles.avatar}>{bossConfig.avatar || '👑'}</Text>
          )}
          <View style={styles.avatarInputContainer}>
            {isImageAvatar(bossConfig.avatar) ? (
              <Text style={styles.avatarPlaceholder}>📷 当前为图片头像</Text>
            ) : (
              <TextInput
                style={styles.avatarInput}
                value={bossConfig.avatar}
                onChangeText={(text) => setBossConfig({ ...bossConfig, avatar: text })}
                placeholder="头像 (emoji)"
                placeholderTextColor="#666"
                maxLength={4}
              />
            )}
          </View>
        </View>

        <TextInput
          style={styles.input}
          value={bossConfig.name}
          onChangeText={(text) => setBossConfig({ ...bossConfig, name: text })}
          placeholder="称呼"
          placeholderTextColor="#666"
        />

        <TouchableOpacity
          style={[styles.button, saving && styles.buttonDisabled]}
          onPress={saveBossConfig}
          disabled={saving}
        >
          <Text style={styles.buttonText}>
            {saving ? '保存中...' : '保存'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 账号信息 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>👤 账号信息</Text>
        {authState.isLoggedIn ? (
          <>
            <View style={styles.accountInfo}>
              <Text style={styles.accountLabel}>昵称</Text>
              <Text style={styles.accountValue}>{authState.displayName || authState.username}</Text>
            </View>
            <View style={styles.accountInfo}>
              <Text style={styles.accountLabel}>用户名</Text>
              <Text style={styles.accountValue}>{authState.username}</Text>
            </View>
            <View style={styles.accountInfo}>
              <Text style={styles.accountLabel}>用户 ID</Text>
              <Text style={styles.accountValue} numberOfLines={1}>{authState.userId}</Text>
            </View>
            <TouchableOpacity
              style={[styles.button, styles.dangerButton, { marginTop: 12 }]}
              onPress={handleLogout}
            >
              <Text style={styles.buttonText}>退出登录</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.description}>
            未登录，数据仅保存在本地。如需云同步，请重启应用进行登录。
          </Text>
        )}
      </View>

      {/* 双向云同步 (Cloudflare) */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🔄 数据同步</Text>
        {authState.isLoggedIn ? (
          <>
            <View style={styles.syncStatusContainer}>
              <Text style={styles.syncStatusIcon}>✅</Text>
              <View style={styles.syncStatusText}>
                <Text style={styles.syncStatusTitle}>自动同步已启用</Text>
                <Text style={styles.syncStatusDesc}>
                  数据会自动在多设备间同步，无需手动操作
                </Text>
              </View>
            </View>
            <View style={styles.syncFeatures}>
              <Text style={styles.syncFeatureItem}>• 启动时自动同步</Text>
              <Text style={styles.syncFeatureItem}>• 发送消息后实时同步</Text>
              <Text style={styles.syncFeatureItem}>• 切回应用时自动同步</Text>
              <Text style={styles.syncFeatureItem}>• 每30秒后台同步</Text>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.description}>
              未登录，无法使用云同步功能。请重启应用进行登录。
            </Text>
          </>
        )}
      </View>

      {/* 旧版云端同步 (本地服务器) - 已隐藏，自动同步已取代 */}
      {false && (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>☁️ 本地服务器同步</Text>
        <Text style={styles.description}>
          使用本地同步服务器（仅限同一网络）
        </Text>
        
        {lastSync ? (
          <Text style={styles.syncTime}>上次同步: {lastSync}</Text>
        ) : null}
        
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton, { flex: 1, marginRight: 8 }, syncing && styles.buttonDisabled]}
            onPress={uploadToCloud}
            disabled={syncing}
          >
            <Text style={styles.buttonText}>
              {syncing ? '同步中...' : '上传到云端'}
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.button, { flex: 1 }, syncing && styles.buttonDisabled]}
            onPress={downloadFromCloud}
            disabled={syncing}
          >
            <Text style={styles.buttonText}>
              {syncing ? '同步中...' : '从云端下载'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      )}

      {/* 数据导入 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📥 导入桌面版数据</Text>
        <Text style={styles.description}>
          在电脑上运行导出脚本，将生成的 JSON 内容粘贴到下方：
        </Text>
        
        <TextInput
          style={[styles.input, styles.textArea]}
          value={importJson}
          onChangeText={setImportJson}
          placeholder='粘贴 soloforge-export.json 的内容...'
          placeholderTextColor="#666"
          multiline
          numberOfLines={4}
        />
        
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.button, styles.secondaryButton, { flex: 1, marginRight: 8 }]}
            onPress={pasteFromClipboard}
          >
            <Text style={styles.buttonText}>从剪贴板粘贴</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.button, { flex: 1 }, importing && styles.buttonDisabled]}
            onPress={importData}
            disabled={importing}
          >
            <Text style={styles.buttonText}>
              {importing ? '导入中...' : '导入数据'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 数据管理 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📱 数据管理</Text>
        <Text style={styles.description}>
          所有数据存储在设备本地，无需服务器即可使用。
        </Text>
        
        <TouchableOpacity
          style={[styles.button, styles.dangerButton]}
          onPress={clearData}
        >
          <Text style={styles.buttonText}>清除所有数据</Text>
        </TouchableOpacity>
      </View>

      {/* 关于与更新 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>关于</Text>
        <Text style={styles.infoText}>SoloForge Mobile v{APP_VERSION}</Text>
        <Text style={styles.infoText}>支持双向云同步，数据可在多设备间共享</Text>
        <Text style={styles.infoText}>直接调用 DeepSeek API</Text>
        
        <TouchableOpacity
          style={[styles.button, { marginTop: 12 }, checkingUpdate && styles.buttonDisabled]}
          onPress={checkForUpdate}
          disabled={checkingUpdate}
        >
          <Text style={styles.buttonText}>
            {checkingUpdate ? '检查中...' : '检查更新'}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#16213e',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#16213e',
  },
  section: {
    backgroundColor: '#1a1a2e',
    margin: 16,
    marginBottom: 0,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatar: {
    fontSize: 48,
    marginRight: 16,
  },
  avatarImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
    marginRight: 16,
    backgroundColor: '#2d2d44',
  },
  avatarInputContainer: {
    flex: 1,
  },
  avatarInput: {
    flex: 1,
    backgroundColor: '#16213e',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 24,
    textAlign: 'center',
  },
  avatarPlaceholder: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    padding: 12,
    color: '#9ca3af',
    fontSize: 16,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  button: {
    backgroundColor: '#4f46e5',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  dangerButton: {
    backgroundColor: '#dc2626',
  },
  secondaryButton: {
    backgroundColor: '#374151',
  },
  accountInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2d2d44',
  },
  accountLabel: {
    color: '#9ca3af',
    fontSize: 14,
  },
  accountValue: {
    color: '#fff',
    fontSize: 14,
    flex: 1,
    textAlign: 'right',
    marginLeft: 10,
  },
  buttonRow: {
    flexDirection: 'row',
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  syncTime: {
    color: '#10b981',
    fontSize: 13,
    marginBottom: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  description: {
    color: '#9ca3af',
    fontSize: 14,
    marginBottom: 16,
    lineHeight: 20,
  },
  infoText: {
    color: '#9ca3af',
    fontSize: 14,
    marginBottom: 8,
  },
  syncStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0a2e1a',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  syncStatusIcon: {
    fontSize: 32,
    marginRight: 12,
  },
  syncStatusText: {
    flex: 1,
  },
  syncStatusTitle: {
    color: '#10b981',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  syncStatusDesc: {
    color: '#6ee7b7',
    fontSize: 13,
    lineHeight: 18,
  },
  syncFeatures: {
    backgroundColor: '#1a1a2e',
    padding: 12,
    borderRadius: 8,
  },
  syncFeatureItem: {
    color: '#9ca3af',
    fontSize: 13,
    marginBottom: 6,
  },
});
