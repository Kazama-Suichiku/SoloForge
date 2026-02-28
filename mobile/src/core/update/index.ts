/**
 * 应用更新服务
 * 检查新版本并提示用户下载更新
 */

import { Alert, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const UPDATE_CHECK_KEY = '@soloforge/last_update_check';
const CURRENT_VERSION = '2.5.3';
const CURRENT_VERSION_CODE = 253;
const DEFAULT_SERVER_URL = 'https://soloforge-sync.fengzhongcuizhu.workers.dev';

interface VersionInfo {
  version: string;
  versionCode: number;
  releaseNotes: string;
  downloadUrl: string;
  apkSize: number;
  updatedAt: string;
}

class UpdateService {
  private serverUrl: string = DEFAULT_SERVER_URL;

  setServerUrl(url: string) {
    this.serverUrl = url || DEFAULT_SERVER_URL;
  }

  getCurrentVersion() {
    return {
      version: CURRENT_VERSION,
      versionCode: CURRENT_VERSION_CODE,
    };
  }

  async checkForUpdate(showNoUpdateAlert = false): Promise<VersionInfo | null> {

    try {
      const response = await fetch(`${this.serverUrl}/app/version`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: VersionInfo = await response.json();
      
      // 记录检查时间
      await AsyncStorage.setItem(UPDATE_CHECK_KEY, Date.now().toString());

      // 比较版本号
      if (data.versionCode > CURRENT_VERSION_CODE) {
        return data;
      }

      if (showNoUpdateAlert) {
        Alert.alert('检查更新', `当前已是最新版本 v${CURRENT_VERSION}`);
      }

      return null;
    } catch (error) {
      console.error('[Update] 检查更新失败:', error);
      if (showNoUpdateAlert) {
        Alert.alert('检查更新', '无法连接到更新服务器');
      }
      return null;
    }
  }

  async promptUpdate(versionInfo: VersionInfo) {
    const sizeInMB = (versionInfo.apkSize / 1024 / 1024).toFixed(1);
    
    Alert.alert(
      `发现新版本 v${versionInfo.version}`,
      `${versionInfo.releaseNotes}\n\n文件大小: ${sizeInMB} MB`,
      [
        { text: '稍后再说', style: 'cancel' },
        {
          text: '立即下载',
          onPress: () => this.downloadUpdate(versionInfo.downloadUrl),
        },
      ]
    );
  }

  async downloadUpdate(downloadUrl: string) {
    if (Platform.OS === 'android') {
      try {
        await Linking.openURL(downloadUrl);
      } catch (error) {
        Alert.alert('下载失败', '无法打开下载链接，请手动下载更新');
      }
    } else {
      Alert.alert('提示', 'iOS 请通过 App Store 或 TestFlight 更新');
    }
  }

  async checkOnStartup() {
    try {
      const lastCheck = await AsyncStorage.getItem(UPDATE_CHECK_KEY);
      const now = Date.now();
      
      // 每 24 小时检查一次
      if (lastCheck && now - parseInt(lastCheck) < 24 * 60 * 60 * 1000) {
        console.log('[Update] 跳过检查，距上次检查不足 24 小时');
        return;
      }

      const update = await this.checkForUpdate();
      if (update) {
        this.promptUpdate(update);
      }
    } catch (error) {
      console.error('[Update] 启动检查失败:', error);
    }
  }
}

export const updateService = new UpdateService();
