/**
 * 应用配置
 * 
 * 打包前请修改 API_BASE_URL 为你的服务器地址
 */

import { Platform } from 'react-native';

// 检测是否是开发环境
const isDev = __DEV__;

/**
 * 获取 API 基础地址
 * 
 * 开发环境：
 * - iOS 模拟器: localhost 可用
 * - Android 模拟器: 需要使用 10.0.2.2
 * - 真机调试: 需要使用电脑的局域网 IP
 * 
 * 生产环境：
 * - 需要配置为实际的云服务器地址
 */
function getApiBaseUrl(): string {
  if (isDev) {
    // 开发环境
    if (Platform.OS === 'android') {
      // Android 模拟器使用 10.0.2.2 访问宿主机 localhost
      return 'http://10.0.2.2:3001/api';
    } else {
      // iOS 模拟器可以直接使用 localhost
      return 'http://localhost:3001/api';
    }
  }
  
  // ============================================
  // 生产环境配置
  // 请将下面的 URL 改为你的实际服务器地址
  // ============================================
  // 本地局域网测试（手机和电脑需在同一 WiFi）
  return 'http://192.168.1.3:3001/api';
  // 云服务器部署时改为：
  // return 'https://your-server.com/api';
}

export const config = {
  // API 服务器地址
  API_BASE_URL: getApiBaseUrl(),
  
  // 应用名称
  APP_NAME: 'SoloForge Mobile',
  
  // 版本号
  VERSION: '2.5.5',
};

export default config;
