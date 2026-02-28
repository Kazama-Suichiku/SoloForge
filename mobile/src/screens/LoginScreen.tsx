/**
 * 登录/注册界面
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { authService } from '../core/auth';

interface Props {
  onLoginSuccess: () => void;
}

export default function LoginScreen({ onLoginSuccess }: Props) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      Alert.alert('提示', '请输入用户名和密码');
      return;
    }

    setLoading(true);
    const result = await authService.login(username.trim(), password);
    setLoading(false);

    if (result.success) {
      onLoginSuccess();
    } else {
      Alert.alert('登录失败', result.error || '请检查用户名和密码');
    }
  };

  const handleRegister = async () => {
    if (!username.trim()) {
      Alert.alert('提示', '请输入用户名');
      return;
    }
    if (username.trim().length < 3) {
      Alert.alert('提示', '用户名至少3个字符');
      return;
    }
    if (!password || password.length < 6) {
      Alert.alert('提示', '密码至少6个字符');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('提示', '两次输入的密码不一致');
      return;
    }

    setLoading(true);
    const result = await authService.register(
      username.trim(),
      password,
      displayName.trim() || undefined
    );
    setLoading(false);

    if (result.success) {
      Alert.alert('注册成功', '欢迎使用 SoloForge！', [
        { text: '确定', onPress: onLoginSuccess }
      ]);
    } else {
      Alert.alert('注册失败', result.error || '请稍后重试');
    }
  };

  const handleSkip = () => {
    Alert.alert(
      '跳过登录',
      '跳过登录后，你的数据将只保存在本地，无法进行云同步。确定要跳过吗？',
      [
        { text: '取消', style: 'cancel' },
        { text: '跳过', onPress: onLoginSuccess },
      ]
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.logo}>🏢</Text>
          <Text style={styles.title}>SoloForge</Text>
          <Text style={styles.subtitle}>AI 员工管理系统</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.formTitle}>
            {isRegister ? '创建账号' : '登录账号'}
          </Text>

          <TextInput
            style={styles.input}
            placeholder="用户名"
            placeholderTextColor="#6b7280"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
          />

          {isRegister && (
            <TextInput
              style={styles.input}
              placeholder="昵称（选填）"
              placeholderTextColor="#6b7280"
              value={displayName}
              onChangeText={setDisplayName}
            />
          )}

          <TextInput
            style={styles.input}
            placeholder="密码"
            placeholderTextColor="#6b7280"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          {isRegister && (
            <TextInput
              style={styles.input}
              placeholder="确认密码"
              placeholderTextColor="#6b7280"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
            />
          )}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={isRegister ? handleRegister : handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {isRegister ? '注册' : '登录'}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.switchButton}
            onPress={() => {
              setIsRegister(!isRegister);
              setPassword('');
              setConfirmPassword('');
            }}
          >
            <Text style={styles.switchText}>
              {isRegister ? '已有账号？去登录' : '没有账号？去注册'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
            <Text style={styles.skipText}>跳过登录，仅本地使用</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            登录后可在多设备间同步数据
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a1a',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    fontSize: 64,
    marginBottom: 10,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 16,
    color: '#9ca3af',
  },
  form: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 20,
  },
  input: {
    backgroundColor: '#0a0a1a',
    borderRadius: 10,
    padding: 15,
    fontSize: 16,
    color: '#fff',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2d2d44',
  },
  button: {
    backgroundColor: '#6366f1',
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  switchButton: {
    marginTop: 20,
    alignItems: 'center',
  },
  switchText: {
    color: '#6366f1',
    fontSize: 14,
  },
  skipButton: {
    marginTop: 15,
    alignItems: 'center',
  },
  skipText: {
    color: '#6b7280',
    fontSize: 13,
  },
  footer: {
    alignItems: 'center',
  },
  footerText: {
    color: '#6b7280',
    fontSize: 13,
  },
});
