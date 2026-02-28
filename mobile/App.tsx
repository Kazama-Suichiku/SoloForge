/**
 * SoloForge Mobile - 主入口
 */

import React, { useEffect, useState, useCallback } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text, View, ActivityIndicator, StyleSheet } from 'react-native';
import { initializeApp } from './src/core/init';
import { authService } from './src/core/auth';
import { cloudSync } from './src/core/sync/cloudSync';

import ChatScreen from './src/screens/ChatScreen';
import AgentsScreen from './src/screens/AgentsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import ConversationsScreen from './src/screens/ConversationsScreen';
import HRScreen from './src/screens/HRScreen';
import CFOScreen from './src/screens/CFOScreen';
import LoginScreen from './src/screens/LoginScreen';

export type RootStackParamList = {
  MainTabs: undefined;
  Chat: { agentId: string; agentName: string; conversationId?: string; initialMessage?: string };
};

export type TabParamList = {
  Agents: undefined;
  Conversations: undefined;
  Dashboard: undefined;
  CFO: undefined;
  HR: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

function MainTabs({ onLogout }: { onLogout: () => void }) {
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#1a1a2e' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: 'bold' },
        tabBarStyle: { backgroundColor: '#1a1a2e', borderTopColor: '#2d2d44' },
        tabBarActiveTintColor: '#4f46e5',
        tabBarInactiveTintColor: '#9ca3af',
      }}
    >
      <Tab.Screen
        name="Agents"
        component={AgentsScreen}
        options={{
          title: '聊天',
          tabBarIcon: ({ color }: { color: string }) => <Text style={{ fontSize: 20, color }}>💬</Text>,
        }}
      />
      <Tab.Screen
        name="Conversations"
        component={ConversationsScreen}
        options={{
          title: '会话',
          tabBarIcon: ({ color }: { color: string }) => <Text style={{ fontSize: 20, color }}>📝</Text>,
        }}
      />
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          title: '运营',
          tabBarIcon: ({ color }: { color: string }) => <Text style={{ fontSize: 20, color }}>📊</Text>,
        }}
      />
      <Tab.Screen
        name="CFO"
        component={CFOScreen}
        options={{
          title: '财务',
          tabBarIcon: ({ color }: { color: string }) => <Text style={{ fontSize: 20, color }}>💰</Text>,
        }}
      />
      <Tab.Screen
        name="HR"
        component={HRScreen}
        options={{
          title: '人事',
          tabBarIcon: ({ color }: { color: string }) => <Text style={{ fontSize: 20, color }}>👥</Text>,
        }}
      />
      <Tab.Screen
        name="Settings"
        options={{
          title: '设置',
          tabBarIcon: ({ color }: { color: string }) => <Text style={{ fontSize: 20, color }}>⚙️</Text>,
        }}
      >
        {() => <SettingsScreen onLogout={onLogout} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [initMessage, setInitMessage] = useState('正在加载...');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        setInitMessage('正在初始化...');
        await initializeApp();
        
        // 检查登录状态
        await authService.initialize();
        const loggedIn = authService.isLoggedIn();
        setIsAuthenticated(loggedIn);

        // 如果已登录，初始化并启动云同步
        if (loggedIn) {
          setInitMessage('正在同步数据...');
          await cloudSync.initialize();
        }
      } catch (error) {
        console.error('Init error:', error);
      }
      setLoading(false);
      setCheckingAuth(false);
    };
    init();
  }, []);

  const handleLoginSuccess = useCallback(async () => {
    setIsAuthenticated(true);
    await cloudSync.initialize();
  }, []);

  const handleLogout = useCallback(() => {
    setIsAuthenticated(false);
  }, []);

  if (loading || checkingAuth) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4f46e5" />
        <Text style={styles.loadingText}>{initMessage}</Text>
      </View>
    );
  }

  // 未登录时显示登录界面
  if (!isAuthenticated) {
    return (
      <SafeAreaProvider>
        <LoginScreen onLoginSuccess={handleLoginSuccess} />
        <StatusBar style="light" />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: '#1a1a2e' },
            headerTintColor: '#fff',
            headerTitleStyle: { fontWeight: 'bold' },
            contentStyle: { backgroundColor: '#16213e' },
          }}
        >
          <Stack.Screen
            name="MainTabs"
            options={{ headerShown: false }}
          >
            {() => <MainTabs onLogout={handleLogout} />}
          </Stack.Screen>
          <Stack.Screen
            name="Chat"
            component={ChatScreen}
            options={({ route }) => ({
              title: route.params.agentName,
            })}
          />
        </Stack.Navigator>
        <StatusBar style="light" />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#16213e',
  },
  loadingText: {
    marginTop: 16,
    color: '#9ca3af',
    fontSize: 16,
  },
});
